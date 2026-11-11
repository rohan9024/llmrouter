import type { ProviderAdapter } from './base.js';
import { ProviderRequestError } from '../errors.js';
import type {
  ChatCompletionCreateParams,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ParsedTarget
} from '../types.js';

export class AnthropicAdapter implements ProviderAdapter {
  private readonly endpoint = 'https://api.anthropic.com/v1/messages';

  private transformPayload(params: ChatCompletionCreateParams, model: string) {
    const systemMessages = params.messages.filter((m) => m.role === 'system');
    const messages = params.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    return {
      model,
      ...(systemMessages.length
        ? { system: systemMessages.map((m) => m.content).join('\n\n') }
        : {}),
      messages,
      max_tokens: params.max_tokens ?? 4096,
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      stream: params.stream ?? false
    };
  }

  private getHeaders(apiKey?: string): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01'
    };
    if (apiKey) headers['x-api-key'] = apiKey;
    return headers;
  }

  async execute(
    target: ParsedTarget,
    params: ChatCompletionCreateParams,
    apiKey?: string,
    timeoutMs = 30000
  ): Promise<ChatCompletionResponse> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.getHeaders(apiKey),
      body: JSON.stringify(this.transformPayload(params, target.model)),
      signal: AbortSignal.timeout(timeoutMs)
    }).catch((err: unknown) => {
      throw new ProviderRequestError(err instanceof Error ? err.message : String(err));
    });

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new ProviderRequestError(message || response.statusText, response.status);
    }

    const data = await response.json() as any;
    const content = (data.content ?? [])
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('');

    return {
      id: data.id ?? `anthropic-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: target.model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: data.stop_reason === 'end_turn' ? 'stop' : (data.stop_reason ?? 'stop')
      }],
      ...(data.usage ? {
        usage: {
          prompt_tokens: data.usage.input_tokens ?? 0,
          completion_tokens: data.usage.output_tokens ?? 0,
          total_tokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0)
        }
      } : {}),
      _routerMeta: {
        providerUsed: target.raw,
        modelUsed: target.model,
        attempts: 1,
        latencyMs: 0
      }
    };
  }

  async executeStream(
    target: ParsedTarget,
    params: ChatCompletionCreateParams,
    apiKey?: string,
    timeoutMs = 30000
  ): Promise<AsyncGenerator<ChatCompletionChunk, void, unknown>> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.getHeaders(apiKey),
      body: JSON.stringify(this.transformPayload({ ...params, stream: true }, target.model)),
      signal: AbortSignal.timeout(timeoutMs)
    }).catch((err: unknown) => {
      throw new ProviderRequestError(err instanceof Error ? err.message : String(err));
    });

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new ProviderRequestError(message || response.statusText, response.status);
    }
    if (!response.body) throw new ProviderRequestError('No response body received from Anthropic');

    return (async function* () {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            try {
              const event = JSON.parse(trimmed.slice(5).trim());
              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                yield {
                  id: 'chunk',
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: target.model,
                  choices: [{ index: 0, delta: { content: event.delta.text } }]
                };
              }
            } catch {
              // Ignore malformed SSE records.
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    })();
  }
}