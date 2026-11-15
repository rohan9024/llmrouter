import { AdapterExecutionOptions, ProviderAdapter, ProviderAdapterCapabilities } from './base.js';
import { parseRetryAfterMs, RouterError } from '../core/errors.js';
import { NormalizedRequest } from '../core/request.js';
import { parseSSEStream } from '../core/stream.js';
import { ChatCompletionChunk, ChatCompletionResponse, ContentPart, ToolCall } from '../types.js';

function convertContentParts(content: string | ContentPart[] | null): any {
  if (!content) return '';
  if (typeof content === 'string') return content;
  const blocks: any[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text });
    } else if (part.type === 'image_url') {
      const url = part.image_url.url;
      const m = /^data:([^;]+);base64,(.+)$/i.exec(url);
      blocks.push(
        m
          ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }
          : { type: 'image', source: { type: 'url', url } }
      );
    }
  }
  return blocks.length > 0 ? blocks : '';
}

function mapStopReason(reason: string | null | undefined): string {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    case 'refusal':
      return 'content_filter';
    default:
      return reason ?? 'stop';
  }
}

export class AnthropicAdapter implements ProviderAdapter {
  public readonly id = 'anthropic';
  public readonly capabilities: ProviderAdapterCapabilities = {
    streaming: true,
    tools: true,
    vision: true,
    structuredOutput: true,
    systemPrompt: true,
    developerRole: true
  };

  private resolveEndpoint(options: AdapterExecutionOptions): string {
    const custom = options.target.baseUrl ?? options.endpointConfig?.baseUrl;
    if (custom) {
      const trimmed = custom.replace(/\/+$/, '');
      return trimmed.endsWith('/messages') ? trimmed : `${trimmed}/messages`;
    }
    return 'https://api.anthropic.com/v1/messages';
  }

  private resolveHeaders(options: AdapterExecutionOptions): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...options.endpointConfig?.headers,
      ...options.target.headers
    };
    if (options.apiKey) headers['x-api-key'] = options.apiKey;
    headers['X-Client-Request-Id'] = options.requestId;
    return headers;
  }

  private transformRequest(request: NormalizedRequest, options: AdapterExecutionOptions, stream: boolean): Record<string, unknown> {
    const params = request.params;
    const systemChunks: string[] = [];
    const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [];

    const pushUserBlocks = (blocks: any[]) => {
      const prev = messages[messages.length - 1];
      if (prev && prev.role === 'user') {
        const prevArr = Array.isArray(prev.content) ? prev.content : [{ type: 'text', text: String(prev.content) }];
        prev.content = [...prevArr, ...blocks];
      } else {
        messages.push({ role: 'user', content: blocks });
      }
    };

    for (const msg of params.messages) {
      if (msg.role === 'system' || msg.role === 'developer') {
        const text =
          typeof msg.content === 'string'
            ? msg.content
            : Array.isArray(msg.content)
              ? msg.content.filter(p => p.type === 'text').map(p => (p as any).text).join('\n')
              : '';
        if (text) systemChunks.push(text);
        continue;
      }

      if (msg.role === 'tool') {
        pushUserBlocks([
          {
            type: 'tool_result',
            tool_use_id: msg.tool_call_id ?? 'unknown_tool_call',
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '')
          }
        ]);
        continue;
      }

      if (msg.role === 'assistant') {
        const blocks: any[] = [];
        const converted = convertContentParts(msg.content);
        if (typeof converted === 'string' && converted.length > 0) blocks.push({ type: 'text', text: converted });
        else if (Array.isArray(converted) && converted.length > 0) blocks.push(...converted);

        if (msg.tool_calls && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
            } catch {
              parsedArgs = { _raw: tc.function.arguments };
            }
            blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: parsedArgs });
          }
        }
        messages.push({ role: 'assistant', content: blocks.length > 0 ? blocks : '' });
        continue;
      }

      const converted = convertContentParts(msg.content);
      if (Array.isArray(converted)) {
        pushUserBlocks(converted);
      } else {
        const prev = messages[messages.length - 1];
        if (prev && prev.role === 'user') pushUserBlocks([{ type: 'text', text: String(converted) }]);
        else messages.push({ role: 'user', content: converted });
      }
    }

    if (params.response_format?.type === 'json_object') systemChunks.push('Respond strictly with valid JSON.');

    const providerExtras = params.providerOptions?.anthropic ?? {};
    const body: Record<string, unknown> = {
      model: options.target.model,
      messages,
      max_tokens: params.max_tokens ?? 4096,
      stream,
      ...providerExtras
    };

    if (systemChunks.length > 0) body.system = systemChunks.join('\n\n');
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.top_p !== undefined) body.top_p = params.top_p;
    if (params.stop !== undefined) body.stop_sequences = Array.isArray(params.stop) ? params.stop : [params.stop];
    if (params.response_format?.type === 'json_schema') {
      body.output_config = { format: { type: 'json_schema', schema: params.response_format.json_schema.schema } };
    }

    if (params.tools && params.tools.length > 0 && params.tool_choice !== 'none') {
      body.tools = params.tools.map(t => ({
        name: t.function.name,
        description: t.function.description ?? '',
        input_schema: t.function.parameters ?? { type: 'object', properties: {} }
      }));
      if (params.tool_choice === 'auto') body.tool_choice = { type: 'auto' };
      else if (params.tool_choice === 'required') body.tool_choice = { type: 'any' };
      else if (typeof params.tool_choice === 'object' && params.tool_choice.type === 'function') {
        body.tool_choice = { type: 'tool', name: params.tool_choice.function.name };
      }
    }

    return body;
  }

  async execute(
    request: NormalizedRequest,
    options: AdapterExecutionOptions
  ): Promise<Omit<ChatCompletionResponse, '_routerMeta'>> {
    let response: Response;
    try {
      response = await fetch(this.resolveEndpoint(options), {
        method: 'POST',
        headers: this.resolveHeaders(options),
        body: JSON.stringify(this.transformRequest(request, options, false)),
        signal: options.signal
      });
    } catch (err) {
      throw this.classifyError(err, { provider: options.target.provider, model: options.target.model, requestId: options.requestId });
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw this.classifyError(new Error(bodyText || response.statusText), {
        provider: options.target.provider,
        model: options.target.model,
        requestId: options.requestId,
        status: response.status,
        headers: response.headers,
        bodyText
      });
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new RouterError({
        code: 'INVALID_RESPONSE',
        message: 'Anthropic returned invalid JSON',
        provider: options.target.provider,
        model: options.target.model,
        status: response.status,
        retryable: false,
        failoverEligible: true,
        requestId: options.requestId
      });
    }

    const contentBlocks = Array.isArray(data?.content) ? data.content : [];
    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];
    for (const block of contentBlocks) {
      if (block.type === 'text' && typeof block.text === 'string') textParts.push(block.text);
      else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id ?? `call_${toolCalls.length}`,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) }
        });
      }
    }

    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;
    const cachedTokens = data.usage?.cache_read_input_tokens ?? 0;

    return {
      id: data.id ?? `anthropic-${options.requestId}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: data.model ?? options.target.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: textParts.length > 0 ? textParts.join('') : toolCalls.length > 0 ? null : '',
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
          },
          finish_reason: mapStopReason(data.stop_reason)
        }
      ],
      usage: data.usage
        ? {
            prompt_tokens: inputTokens,
            completion_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens,
            ...(cachedTokens > 0 ? { prompt_tokens_details: { cached_tokens: cachedTokens } } : {})
          }
        : undefined
    };
  }

  async executeStream(request: NormalizedRequest, options: AdapterExecutionOptions): Promise<AsyncIterable<ChatCompletionChunk>> {
    let response: Response;
    try {
      response = await fetch(this.resolveEndpoint(options), {
        method: 'POST',
        headers: this.resolveHeaders(options),
        body: JSON.stringify(this.transformRequest(request, options, true)),
        signal: options.signal
      });
    } catch (err) {
      throw this.classifyError(err, { provider: options.target.provider, model: options.target.model, requestId: options.requestId });
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw this.classifyError(new Error(bodyText || response.statusText), {
        provider: options.target.provider,
        model: options.target.model,
        requestId: options.requestId,
        status: response.status,
        headers: response.headers,
        bodyText
      });
    }

    if (!response.body) {
      throw new RouterError({
        code: 'INVALID_RESPONSE',
        message: 'Empty Anthropic stream body',
        provider: options.target.provider,
        model: options.target.model,
        retryable: true,
        failoverEligible: true,
        requestId: options.requestId
      });
    }

    const self = this;
    const bodyStream = response.body;
    const target = options.target;
    const requestId = options.requestId;

    return (async function* (): AsyncGenerator<ChatCompletionChunk, void, unknown> {
      let msgId = `anthropic-${requestId}`;
      let msgModel = target.model;
      let inputTokens = 0;
      let cachedTokens = 0;
      let nextToolIndex = 0;
      const blockToToolIdx = new Map<number, number>();

      for await (const sse of parseSSEStream(bodyStream, options.signal)) {
        if (sse.data === '[DONE]') return;
        let evt: any;
        try {
          evt = JSON.parse(sse.data);
        } catch {
          continue;
        }

        if (evt.type === 'error') {
          throw self.classifyError(new Error(evt.error?.message ?? 'Anthropic stream error'), {
            provider: target.provider,
            model: target.model,
            requestId,
            status: evt.error?.type === 'overloaded_error' ? 529 : 500,
            bodyText: sse.data
          });
        }
        if (evt.type === 'message_start') {
          msgId = evt.message?.id ?? msgId;
          msgModel = evt.message?.model ?? msgModel;
          inputTokens = evt.message?.usage?.input_tokens ?? 0;
          cachedTokens = evt.message?.usage?.cache_read_input_tokens ?? 0;
          continue;
        }
        if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
          const toolIndex = nextToolIndex++;
          blockToToolIdx.set(evt.index, toolIndex);
          yield {
            id: msgId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: msgModel,
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  tool_calls: [{ index: toolIndex, id: evt.content_block.id, type: 'function', function: { name: evt.content_block.name, arguments: '' } }]
                }
              }
            ]
          };
          continue;
        }
        if (evt.type === 'content_block_delta') {
          if (evt.delta?.type === 'text_delta' && typeof evt.delta.text === 'string') {
            yield {
              id: msgId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: msgModel,
              choices: [{ index: 0, delta: { content: evt.delta.text } }]
            };
          } else if (evt.delta?.type === 'input_json_delta' && typeof evt.delta.partial_json === 'string') {
            const toolIndex = blockToToolIdx.get(evt.index) ?? 0;
            yield {
              id: msgId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: msgModel,
              choices: [{ index: 0, delta: { tool_calls: [{ index: toolIndex, function: { arguments: evt.delta.partial_json } }] } }]
            };
          }
          continue;
        }
        if (evt.type === 'message_delta') {
          const outputTokens = evt.usage?.output_tokens ?? 0;
          yield {
            id: msgId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: msgModel,
            choices: [{ index: 0, delta: {}, finish_reason: mapStopReason(evt.delta?.stop_reason) }],
            usage: {
              prompt_tokens: inputTokens,
              completion_tokens: outputTokens,
              total_tokens: inputTokens + outputTokens,
              ...(cachedTokens > 0 ? { prompt_tokens_details: { cached_tokens: cachedTokens } } : {})
            }
          };
        }
      }
    })();
  }

  classifyError(
    error: unknown,
    context: { provider: string; model: string; requestId: string; status?: number; headers?: Headers; bodyText?: string }
  ): RouterError {
    if (error instanceof RouterError) return error;
    const errName = error instanceof Error ? error.name : '';
    const rawMsg = error instanceof Error ? error.message : String(error);

    if (errName === 'AbortError') {
      return new RouterError({ code: 'CANCELLED', message: 'Request cancelled', provider: context.provider, model: context.model, retryable: false, failoverEligible: false, requestId: context.requestId });
    }
    if (errName === 'TimeoutError') {
      return new RouterError({ code: 'TIMEOUT', message: 'Anthropic request timed out', provider: context.provider, model: context.model, retryable: true, failoverEligible: true, requestId: context.requestId });
    }

    let antType: string | undefined;
    let antMsg = rawMsg;
    if (context.bodyText) {
      try {
        const json = JSON.parse(context.bodyText);
        antType = json?.error?.type;
        if (json?.error?.message) antMsg = String(json.error.message);
      } catch {}
    }

    const lower = antMsg.toLowerCase();
    const retryAfterMs = parseRetryAfterMs(context.headers);
    const status = context.status;

    if (!status) {
      return new RouterError({ code: 'NETWORK_ERROR', message: antMsg || 'Network failure', provider: context.provider, model: context.model, retryable: true, failoverEligible: true, requestId: context.requestId });
    }
    if (status === 401 || antType === 'authentication_error') {
      return new RouterError({ code: 'AUTHENTICATION', message: antMsg || 'Authentication error', provider: context.provider, model: context.model, status, providerCode: antType, retryable: false, failoverEligible: true, cooldownMs: 60_000, requestId: context.requestId });
    }
    if (status === 402 || status === 403 || antType === 'permission_error' || lower.includes('credit balance')) {
      return new RouterError({ code: 'PERMISSION_DENIED', message: antMsg || 'Permission or billing error', provider: context.provider, model: context.model, status, providerCode: antType, retryable: false, failoverEligible: true, cooldownMs: 300_000, requestId: context.requestId });
    }
    if (status === 404 || antType === 'not_found_error') {
      return new RouterError({ code: 'MODEL_NOT_FOUND', message: antMsg || 'Model not found', provider: context.provider, model: context.model, status, providerCode: antType, retryable: false, failoverEligible: true, cooldownMs: 300_000, requestId: context.requestId });
    }
    if (status === 429 || antType === 'rate_limit_error') {
      return new RouterError({ code: 'RATE_LIMITED', message: antMsg || 'Rate limit exceeded', provider: context.provider, model: context.model, status, providerCode: antType, retryable: true, failoverEligible: true, retryAfterMs, cooldownMs: retryAfterMs ?? 5000, requestId: context.requestId });
    }
    if (lower.includes('prompt is too long') || lower.includes('context_length') || lower.includes('tokens >')) {
      return new RouterError({ code: 'CONTEXT_LENGTH', message: antMsg, provider: context.provider, model: context.model, status, providerCode: antType, retryable: false, failoverEligible: true, requestId: context.requestId });
    }
    if (status === 400 || antType === 'invalid_request_error') {
      return new RouterError({ code: 'INVALID_REQUEST', message: antMsg || 'Invalid request', provider: context.provider, model: context.model, status, providerCode: antType, retryable: false, failoverEligible: false, requestId: context.requestId });
    }
    return new RouterError({
      code: status >= 500 || antType === 'overloaded_error' ? 'PROVIDER_UNAVAILABLE' : 'INVALID_REQUEST',
      message: antMsg || 'Anthropic service error',
      provider: context.provider,
      model: context.model,
      status,
      providerCode: antType,
      retryable: status >= 500,
      failoverEligible: status >= 500,
      retryAfterMs,
      requestId: context.requestId
    });
  }
}
