import type { ProviderAdapter } from './base.js';
import { ProviderRequestError } from '../errors.js';
import type {
  ChatCompletionCreateParams,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ParsedTarget
} from '../types.js';

const ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  ollama: 'http://localhost:11434/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
};

export class OpenAICompatAdapter implements ProviderAdapter {
  private getEndpoint(provider: string): string {
    const endpoint = ENDPOINTS[provider];
    if (!endpoint) throw new ProviderRequestError(`Unsupported provider: ${provider}`, 400);
    return endpoint;
  }

  private getHeaders(apiKey?: string): HeadersInit {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return headers;
  }

  async execute(
    target: ParsedTarget,
    params: ChatCompletionCreateParams,
    apiKey?: string,
    timeoutMs = 30000
  ): Promise<ChatCompletionResponse> {
    const response = await fetch(this.getEndpoint(target.provider), {
      method: 'POST',
      headers: this.getHeaders(apiKey),
      body: JSON.stringify({ ...params, model: target.model, stream: false }),
      signal: AbortSignal.timeout(timeoutMs)
    }).catch((err: unknown) => {
      throw new ProviderRequestError(err instanceof Error ? err.message : String(err));
    });

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new ProviderRequestError(message || response.statusText, response.status);
    }

    return await response.json() as ChatCompletionResponse;
  }

  async executeStream(
    target: ParsedTarget,
    params: ChatCompletionCreateParams,
    apiKey?: string,
    timeoutMs = 30000
  ): Promise<AsyncGenerator<ChatCompletionChunk, void, unknown>> {
    const response = await fetch(this.getEndpoint(target.provider), {
      method: 'POST',
      headers: this.getHeaders(apiKey),
      body: JSON.stringify({ ...params, model: target.model, stream: true }),
      signal: AbortSignal.timeout(timeoutMs)
    }).catch((err: unknown) => {
      throw new ProviderRequestError(err instanceof Error ? err.message : String(err));
    });

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new ProviderRequestError(message || response.statusText, response.status);
    }
    if (!response.body) throw new ProviderRequestError('No response body received for stream');

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
            if (!trimmed || trimmed.startsWith(':')) continue;
            if (trimmed === 'data: [DONE]') return;
            if (trimmed.startsWith('data:')) {
              try {
                yield JSON.parse(trimmed.slice(5).trim()) as ChatCompletionChunk;
              } catch {
                // Ignore malformed or incomplete SSE records.
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    })();
  }
}