export type Role = 'system' | 'developer' | 'user' | 'assistant' | 'tool';

export interface TextContentPart {
  type: 'text';
  text: string;
}

export interface ImageUrlContentPart {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export type ContentPart = TextContentPart | ImageUrlContentPart;

export interface ToolFunctionDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export interface ToolDefinition {
  type: 'function';
  function: ToolFunctionDefinition;
}

export type ToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | { type: 'function'; function: { name: string } };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: Role;
  content: string | ContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export type ResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | {
      type: 'json_schema';
      json_schema: {
        name: string;
        description?: string;
        schema: Record<string, unknown>;
        strict?: boolean;
      };
    };

export interface ChatCompletionCreateParams {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string | string[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  tools?: ToolDefinition[];
  tool_choice?: ToolChoice;
  parallel_tool_calls?: boolean;
  response_format?: ResponseFormat;
  seed?: number;
  user?: string;
  providerOptions?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ModelCapabilities {
  text: boolean;
  vision: boolean;
  tools: boolean;
  structuredOutput: boolean;
  audioInput: boolean;
  audioOutput: boolean;
  reasoning: boolean;
}

export interface PrivacyMetadata {
  zeroDataRetention: boolean | 'unknown';
  dataResidency?: string[];
  source?: string;
}

export interface ModelPricing {
  inputPerMillionTokens: number;
  outputPerMillionTokens: number;
  cachedInputPerMillionTokens?: number;
  updatedAt: string;
  source: string;
}

export interface ModelDefinition {
  id: string;
  provider: string;
  model: string;
  capabilities: ModelCapabilities;
  contextWindow?: number;
  maxOutputTokens?: number;
  pricing?: ModelPricing;
  privacy: PrivacyMetadata;
  weight?: number;
  baseUrl?: string;
  headers?: Record<string, string>;
  apiKeyEnv?: string;
  maxConcurrency?: number;
}

export type ModelConfigInput =
  | string
  | {
      id: string;
      capabilities?: Partial<ModelCapabilities>;
      contextWindow?: number;
      maxOutputTokens?: number;
      pricing?: ModelPricing;
      privacy?: PrivacyMetadata;
      weight?: number;
      baseUrl?: string;
      headers?: Record<string, string>;
      apiKeyEnv?: string;
      maxConcurrency?: number;
    };

export type RoutingStrategyName =
  | 'priority'
  | 'weighted'
  | 'lowest-cost'
  | 'lowest-latency'
  | 'health-aware'
  | 'balanced';

export type RouterErrorCode =
  | 'RATE_LIMITED'
  | 'AUTHENTICATION'
  | 'PERMISSION_DENIED'
  | 'MODEL_NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'CONTEXT_LENGTH'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'CONTENT_POLICY'
  | 'CANCELLED'
  | 'BUDGET_EXCEEDED';

export interface RouterErrorInfo {
  code: RouterErrorCode;
  message: string;
  provider: string;
  model: string;
  status?: number;
  providerCode?: string;
  retryable: boolean;
  failoverEligible: boolean;
  retryAfterMs?: number;
  cooldownMs?: number;
  requestId: string;
}

export interface AttemptRecord {
  target: string;
  provider: string;
  model: string;
  attemptNumber: number;
  retryNumber: number;
  status: 'success' | 'failed';
  latencyMs: number;
  ttftMs?: number;
  errorCode?: RouterErrorCode;
  httpStatus?: number;
  errorMessage?: string;
  estimatedCostUsd?: number;
  reportedUsageCostUsd?: number;
}

export interface RouterMeta {
  requestId: string;
  providerUsed: string;
  modelUsed: string;
  attemptCount: number;
  retryCount: number;
  fallbackUsed: boolean;
  totalLatencyMs: number;
  timeToFirstTokenMs?: number;
  routeStrategy: RoutingStrategyName;
  routeReason: string;
  estimatedCostUsd?: number;
  reportedUsageCostUsd?: number;
  verifiedBilledCostUsd?: number;
  attempts: AttemptRecord[];
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

export interface ChatCompletionChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: ToolCall[];
    refusal?: string | null;
  };
  finish_reason: string | null;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: ChatCompletionUsage;
  _routerMeta: RouterMeta;
}

export interface ChatCompletionChunkToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: {
    role?: 'assistant';
    content?: string | null;
    tool_calls?: ChatCompletionChunkToolCallDelta[];
  };
  finish_reason?: string | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  usage?: ChatCompletionUsage | null;
}

export interface RetryConfig {
  maxRetriesPerTarget?: number;
  maxTotalAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: 'full' | 'equal' | 'none';
  respectRetryAfter?: boolean;
  maxRetryAfterMs?: number;
  retryOnTimeout?: boolean;
}

export interface CircuitBreakerConfig {
  enabled?: boolean;
  rollingWindowMs?: number;
  failureThreshold?: number;
  openDurationMs?: number;
  halfOpenProbes?: number;
}

export interface TimeoutConfig {
  perAttemptMs?: number;
  totalTimeoutMs?: number;
}

export interface ConcurrencyConfig {
  maxConcurrentPerProvider?: number;
  maxConcurrentPerModel?: number;
  maxQueueSize?: number;
  queueTimeoutMs?: number;
}

export interface BalancedWeights {
  cost: number;
  latency: number;
  reliability: number;
}

export interface AdaptiveConfig {
  minSamples?: number;
  explorationRate?: number;
  weights?: Partial<BalancedWeights>;
  randomFn?: () => number;
}

export interface PrivacyConstraints {
  zeroDataRetentionOnly?: boolean;
  allowedProviders?: string[];
  blockedProviders?: string[];
  allowedRegions?: string[];
}

export interface BudgetConfig {
  maxEstimatedCostUsd?: number;
  maxSessionCostUsd?: number;
}

export interface ProviderEndpointConfig {
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  headers?: Record<string, string>;
  type?: 'openai-compatible' | 'anthropic' | 'gemini';
}

export interface TelemetrySpan {
  end(attributes?: Record<string, unknown>, error?: Error): void;
}

export interface TelemetryHooks {
  startSpan?(name: string, attributes?: Record<string, unknown>): TelemetrySpan;
}

export interface RouterConfig {
  models: ModelConfigInput[];
  strategy?: RoutingStrategyName;
  apiKeys?: Record<string, string>;
  providers?: Record<string, ProviderEndpointConfig>;
  registryOverrides?: ModelDefinition[];
  timeoutMs?: number;
  timeout?: TimeoutConfig;
  retry?: RetryConfig;
  circuitBreaker?: CircuitBreakerConfig;
  concurrency?: ConcurrencyConfig;
  adaptive?: AdaptiveConfig;
  privacy?: PrivacyConstraints;
  budget?: BudgetConfig;
  logPrompts?: boolean;
  telemetry?: TelemetryHooks;
  now?: () => number;
}

export interface RequestExecutionOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  perAttemptMs?: number;
  strategy?: RoutingStrategyName;
  models?: ModelConfigInput[];
  capabilities?: Partial<ModelCapabilities>;
  privacy?: PrivacyConstraints;
  budget?: { maxEstimatedCostUsd?: number };
  idempotencyKey?: string;
}

export interface ExplainCandidate {
  model: string;
  provider: string;
  estimatedCostUsd?: number;
  observedLatencyMs?: number;
  score?: number;
  healthState: 'closed' | 'open' | 'half-open' | 'cooldown';
}

export interface ExplainRejection {
  model: string;
  reason: string;
  code: string;
}

export interface ExplainResult {
  selected: string | null;
  strategy: RoutingStrategyName;
  reason: string[];
  candidates: ExplainCandidate[];
  rejected: ExplainRejection[];
  estimatedInputTokens: number;
  requiredCapabilities: Partial<ModelCapabilities>;
}

export interface ModelRuntimeStats {
  id: string;
  provider: string;
  attempts: number;
  successes: number;
  failures: number;
  rateLimits: number;
  averageLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  averageTtftMs: number;
  tokensPerSecond: number;
  circuitState: 'closed' | 'open' | 'half-open';
  cooldownUntil?: number;
}

export interface RouterStats {
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  fallbackRequests: number;
  retryCount: number;
  totalEstimatedCostUsd: number;
  totalReportedUsageCostUsd: number;
  averageLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  perModel: Record<string, ModelRuntimeStats>;
}

export type RouterEventType =
  | 'attempt'
  | 'retry'
  | 'fallback'
  | 'circuit-open'
  | 'circuit-close'
  | 'cooldown'
  | 'success'
  | 'failure';

export interface RouterEventPayload {
  type: RouterEventType;
  requestId: string;
  timestamp: number;
  target?: string;
  provider?: string;
  model?: string;
  attemptNumber?: number;
  retryNumber?: number;
  latencyMs?: number;
  errorCode?: RouterErrorCode;
  message?: string;
  strategy?: RoutingStrategyName;
  cooldownMs?: number;
  estimatedCostUsd?: number;
  reportedUsageCostUsd?: number;
}

export type RouterEventListener = (event: RouterEventPayload) => void;
