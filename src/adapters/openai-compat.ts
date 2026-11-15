import {
  AdapterExecutionOptions,
  ProviderAdapter,
  ProviderAdapterCapabilities
} from './base.js';
import { parseRetryAfterMs, RouterError } from '../core/errors.js';
import { NormalizedRequest } from '../core/request.js';
import { parseSSEStream } from '../core/stream.js';
import { ChatCompletionChunk, ChatCompletionResponse, ChatMessage } from '../types.js';

const DEFAULT_ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  ollama: 'http://localhost:11434/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  together: 'https://api.together.xyz/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  mistral: 'https://api.mistral.ai/v1/chat/completions'
};

export class OpenAICompatAdapter implements ProviderAdapter {
  public readonly id: string = 'openai-compatible';
  public readonly capabilities: ProviderAdapterCapabilities = {
    streaming: true,
    tools: true,
    vision: true,
    structuredOutput: true,
    systemPrompt: true,
    developerRole: true
  };

  protected resolveEndpoint(options: AdapterExecutionOptions): string {
    const customBase = options.target.baseUrl ?? options.endpointConfig?.baseUrl;
    if (customBase) {
      const trimmed = customBase.replace(/\/+$/, '');
      return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
    }
    if (options.target.provider === 'ollama' && process.env.OLLAMA_HOST) {
      return `${process.env.OLLAMA_HOST.replace(/\/+$/, '')}/v1/chat/completions`;
    }
    return DEFAULT_ENDPOINTS[options.target.provider] ?? DEFAULT_ENDPOINTS.openai;
  }

  protected resolveHeaders(options: AdapterExecutionOptions): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.endpointConfig?.headers,
      ...options.target.headers
    };
    if (options.apiKey) headers['Authorization'] = `Bearer ${options.apiKey}`;
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    headers['X-Client-Request-Id'] = options.requestId;
    return headers;
  }

  protected sanitizeMessages(provider: string, messages: ChatMessage[]): ChatMessage[] {
    if (provider === 'openai') return messages;
    return messages.map(m => (m.role === 'developer' ? { ...m, role: 'system' } : m));
  }

  protected buildBody(
    request: NormalizedRequest,
    options: AdapterExecutionOptions,
    stream: boolean
  ): string {
    const { providerOptions, model: _ignored, ...rest } = request.params;
    const providerExtras = providerOptions?.[options.target.provider] ?? {};
    const payload: Record<string, unknown> = {
      ...rest,
      ...providerExtras,
      model: options.target.model,
      messages: this.sanitizeMessages(options.target.provider, request.params.messages),
      stream
    };

    if (stream && (options.target.provider === 'openai' || options.target.provider === 'groq')) {
      payload.stream_options = { include_usage: true, ...(request.params.stream_options ?? {}) };
    } else if (!stream) {
      delete payload.stream_options;
    }

    return JSON.stringify(payload);
  }

  async execute(
    request: NormalizedRequest,
    options: AdapterExecutionOptions
  ): Promise<Omit<ChatCompletionResponse, '_routerMeta'> & { verifiedBilledCostUsd?: number }> {
    const endpoint = this.resolveEndpoint(options);
    let response: Response;

    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: this.resolveHeaders(options),
        body: this.buildBody(request, options, false),
        signal: options.signal
      });
    } catch (err) {
      throw this.classifyError(err, {
        provider: options.target.provider,
        model: options.target.model,
        requestId: options.requestId
      });
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

    let json: any;
    try {
      json = await response.json();
    } catch {
      throw new RouterError({
        code: 'INVALID_RESPONSE',
        message: 'Provider returned invalid JSON response',
        provider: options.target.provider,
        model: options.target.model,
        status: response.status,
        retryable: false,
        failoverEligible: true,
        requestId: options.requestId
      });
    }

    if (!json || !Array.isArray(json.choices) || json.choices.length === 0) {
      throw new RouterError({
        code: 'INVALID_RESPONSE',
        message: 'Provider response missing choices array',
        provider: options.target.provider,
        model: options.target.model,
        status: response.status,
        retryable: false,
        failoverEligible: true,
        requestId: options.requestId
      });
    }

    const verifiedBilledCostUsd = typeof json?.usage?.cost === 'number' ? json.usage.cost : undefined;

    return {
      id: json.id ?? `${options.target.provider}-${options.requestId}`,
      object: 'chat.completion',
      created: json.created ?? Math.floor(Date.now() / 1000),
      model: json.model ?? options.target.model,
      choices: json.choices,
      usage: json.usage,
      verifiedBilledCostUsd
    };
  }

  async executeStream(
    request: NormalizedRequest,
    options: AdapterExecutionOptions
  ): Promise<AsyncIterable<ChatCompletionChunk>> {
    const endpoint = this.resolveEndpoint(options);
    let response: Response;

    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: this.resolveHeaders(options),
        body: this.buildBody(request, options, true),
        signal: options.signal
      });
    } catch (err) {
      throw this.classifyError(err, {
        provider: options.target.provider,
        model: options.target.model,
        requestId: options.requestId
      });
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
        message: 'Empty stream response body',
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
      for await (const evt of parseSSEStream(bodyStream, options.signal)) {
        if (evt.data === '[DONE]') return;
        let parsed: any;
        try {
          parsed = JSON.parse(evt.data);
        } catch {
          continue;
        }
        if (parsed?.error) {
          throw self.classifyError(new Error(parsed.error.message ?? 'Stream error'), {
            provider: target.provider,
            model: target.model,
            requestId,
            bodyText: evt.data
          });
        }
        yield parsed as ChatCompletionChunk;
      }
    })();
  }

  classifyError(
    error: unknown,
    context: {
      provider: string;
      model: string;
      requestId: string;
      status?: number;
      headers?: Headers;
      bodyText?: string;
    }
  ): RouterError {
    if (error instanceof RouterError) return error;

    const errName = error instanceof Error ? error.name : '';
    const rawMsg = error instanceof Error ? error.message : String(error);

    if (errName === 'AbortError') {
      return new RouterError({
        code: 'CANCELLED',
        message: 'Request cancelled',
        provider: context.provider,
        model: context.model,
        retryable: false,
        failoverEligible: false,
        requestId: context.requestId
      });
    }
    if (errName === 'TimeoutError') {
      return new RouterError({
        code: 'TIMEOUT',
        message: 'Request timed out',
        provider: context.provider,
        model: context.model,
        retryable: true,
        failoverEligible: true,
        requestId: context.requestId
      });
    }

    let parsedCode: string | undefined;
    let parsedType: string | undefined;
    let parsedMsg = rawMsg;

    if (context.bodyText) {
      try {
        const json = JSON.parse(context.bodyText);
        const errObj = json?.error ?? json;
        parsedCode = errObj?.code ? String(errObj.code) : undefined;
        parsedType = errObj?.type ? String(errObj.type) : undefined;
        if (errObj?.message) parsedMsg = String(errObj.message);
      } catch {
        // non-JSON
      }
    }

    const lowerMsg = parsedMsg.toLowerCase();
    const retryAfterMs = parseRetryAfterMs(context.headers);
    const status = context.status;

    if (!status) {
      return new RouterError({
        code: 'NETWORK_ERROR',
        message: parsedMsg || 'Network failure',
        provider: context.provider,
        model: context.model,
        retryable: true,
        failoverEligible: true,
        requestId: context.requestId
      });
    }

    if (status === 401 || parsedCode === 'invalid_api_key' || parsedType === 'authentication_error') {
      return new RouterError({
        code: 'AUTHENTICATION',
        message: parsedMsg || 'Authentication failed',
        provider: context.provider,
        model: context.model,
        status,
        providerCode: parsedCode ?? parsedType,
        retryable: false,
        failoverEligible: true,
        cooldownMs: 60_000,
        requestId: context.requestId
      });
    }

    if (status === 402 || parsedCode === 'insufficient_quota' || lowerMsg.includes('exceeded your current quota')) {
      return new RouterError({
        code: 'PERMISSION_DENIED',
        message: parsedMsg || 'Quota or billing limit exceeded',
        provider: context.provider,
        model: context.model,
        status,
        providerCode: parsedCode ?? parsedType,
        retryable: false,
        failoverEligible: true,
        cooldownMs: 300_000,
        requestId: context.requestId
      });
    }

    if (status === 403) {
      return new RouterError({
        code: 'PERMISSION_DENIED',
        message: parsedMsg || 'Permission denied',
        provider: context.provider,
        model: context.model,
        status,
        providerCode: parsedCode ?? parsedType,
        retryable: false,
        failoverEligible: true,
        cooldownMs: 60_000,
        requestId: context.requestId
      });
    }

    if (status === 404 || parsedCode === 'model_not_found') {
      return new RouterError({
        code: 'MODEL_NOT_FOUND',
        message: parsedMsg || 'Model not found',
        provider: context.provider,
        model: context.model,
        status,
        providerCode: parsedCode ?? parsedType,
        retryable: false,
        failoverEligible: true,
        cooldownMs: 300_000,
        requestId: context.requestId
      });
    }

    if (status === 429 || parsedCode === 'rate_limit_exceeded') {
      return new RouterError({
        code: 'RATE_LIMITED',
        message: parsedMsg || 'Rate limit exceeded',
        provider: context.provider,
        model: context.model,
        status,
        providerCode: parsedCode ?? parsedType,
        retryable: true,
        failoverEligible: true,
        retryAfterMs,
        cooldownMs: retryAfterMs ?? 5000,
        requestId: context.requestId
      });
    }

    if (
      parsedCode === 'context_length_exceeded' ||
      lowerMsg.includes('maximum context length') ||
      lowerMsg.includes('context window') ||
      lowerMsg.includes('too many tokens')
    ) {
      return new RouterError({
        code: 'CONTEXT_LENGTH',
        message: parsedMsg || 'Context length exceeded',
        provider: context.provider,
        model: context.model,
        status,
        providerCode: parsedCode ?? parsedType,
        retryable: false,
        failoverEligible: true,
        requestId: context.requestId
      });
    }

    if (
      parsedCode === 'content_filter' ||
      lowerMsg.includes('content policy') ||
      lowerMsg.includes('safety system')
    ) {
      return new RouterError({
        code: 'CONTENT_POLICY',
        message: parsedMsg || 'Content policy violation',
        provider: context.provider,
        model: context.model,
        status,
        providerCode: parsedCode ?? parsedType,
        retryable: false,
        failoverEligible: false,
        requestId: context.requestId
      });
    }

    if (status === 408 || status === 504) {
      return new RouterError({
        code: 'TIMEOUT',
        message: parsedMsg || 'Upstream timeout',
        provider: context.provider,
        model: context.model,
        status,
        providerCode: parsedCode ?? parsedType,
        retryable: true,
        failoverEligible: true,
        requestId: context.requestId
      });
    }

    if (status === 400 || status === 422) {
      return new RouterError({
        code: 'INVALID_REQUEST',
        message: parsedMsg || 'Invalid request',
        provider: context.provider,
        model: context.model,
        status,
        providerCode: parsedCode ?? parsedType,
        retryable: false,
        failoverEligible: false,
        requestId: context.requestId
      });
    }

    if (status >= 500) {
      return new RouterError({
        code: 'PROVIDER_UNAVAILABLE',
        message: parsedMsg || 'Provider infrastructure unavailable',
        provider: context.provider,
        model: context.model,
        status,
        providerCode: parsedCode ?? parsedType,
        retryable: true,
        failoverEligible: true,
        retryAfterMs,
        requestId: context.requestId
      });
    }

    return new RouterError({
      code: 'INVALID_REQUEST',
      message: parsedMsg || `HTTP ${status}`,
      provider: context.provider,
      model: context.model,
      status,
      providerCode: parsedCode ?? parsedType,
      retryable: false,
      failoverEligible: false,
      requestId: context.requestId
    });
  }
}