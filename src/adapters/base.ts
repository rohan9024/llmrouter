import { ChatCompletionChunk, ChatCompletionResponse, ModelDefinition, ProviderEndpointConfig } from '../types.js';
import { NormalizedRequest } from '../core/request.js';
import { RouterError } from '../core/errors.js';

export interface ProviderAdapterCapabilities {
  streaming: boolean;
  tools: boolean;
  vision: boolean;
  structuredOutput: boolean;
  systemPrompt: boolean;
  developerRole: boolean;
}

export interface AdapterExecutionOptions {
  target: ModelDefinition;
  apiKey?: string;
  endpointConfig?: ProviderEndpointConfig;
  signal: AbortSignal;
  requestId: string;
  idempotencyKey?: string;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly capabilities: ProviderAdapterCapabilities;

  execute(
    request: NormalizedRequest,
    options: AdapterExecutionOptions
  ): Promise<Omit<ChatCompletionResponse, '_routerMeta'> & { verifiedBilledCostUsd?: number }>;

  executeStream(request: NormalizedRequest, options: AdapterExecutionOptions): Promise<AsyncIterable<ChatCompletionChunk>>;

  classifyError(
    error: unknown,
    context: { provider: string; model: string; requestId: string; status?: number; headers?: Headers; bodyText?: string }
  ): RouterError;
}
