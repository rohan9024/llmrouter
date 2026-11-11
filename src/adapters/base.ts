import type {
  ChatCompletionCreateParams,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ParsedTarget
} from '../types.js';

export interface ProviderAdapter {
  execute(
    target: ParsedTarget,
    params: ChatCompletionCreateParams,
    apiKey?: string,
    timeoutMs?: number
  ): Promise<ChatCompletionResponse>;

  executeStream(
    target: ParsedTarget,
    params: ChatCompletionCreateParams,
    apiKey?: string,
    timeoutMs?: number
  ): Promise<AsyncGenerator<ChatCompletionChunk, void, unknown>>;
}