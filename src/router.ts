import {
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionResponse,
  ExplainResult,
  ModelConfigInput,
  ModelDefinition,
  RequestExecutionOptions,
  RouterConfig,
  RouterEventListener,
  RouterEventType,
  RouterStats
} from './types.js';
import { ModelRegistry } from './catalog/models.js';
import { AdapterRegistry, ProviderAdapter } from './adapters/index.js';
import { RetryController } from './reliability/retry.js';
import { HealthManager } from './reliability/health.js';
import { ConcurrencyLimiter } from './reliability/concurrency.js';
import { RoutingPlanner } from './routing/planner.js';
import { MetricsTracker } from './observability/metrics.js';
import { normalizeRequest } from './core/request.js';
import { ExecutionEngine } from './core/engine.js';

export class Router {
  private readonly config: RouterConfig;
  private readonly registry: ModelRegistry;
  private readonly adapters: AdapterRegistry;
  private readonly retry: RetryController;
  private readonly health: HealthManager;
  private readonly concurrency: ConcurrencyLimiter;
  private readonly planner: RoutingPlanner;
  private readonly metrics: MetricsTracker;
  private readonly engine: ExecutionEngine;
  private readonly configuredModels: ModelDefinition[];
  private readonly now: () => number;

  constructor(options: RouterConfig | ModelConfigInput[]) {
    const cfg: RouterConfig = Array.isArray(options) ? { models: options } : options;
    if (!cfg.models || cfg.models.length === 0) {
      throw new Error('Router requires at least one model configuration.');
    }

    this.config = cfg;
    this.now = cfg.now ?? Date.now;
    this.registry = new ModelRegistry(cfg.registryOverrides);
    this.adapters = new AdapterRegistry();
    this.retry = new RetryController(cfg.retry, cfg.adaptive?.randomFn);
    this.health = new HealthManager(cfg.circuitBreaker, this.now);
    this.concurrency = new ConcurrencyLimiter(cfg.concurrency);
    this.planner = new RoutingPlanner(cfg.adaptive);
    this.metrics = new MetricsTracker();
    this.configuredModels = cfg.models.map(m => this.registry.resolve(m));

    this.engine = new ExecutionEngine(
      this.config,
      this.retry,
      this.health,
      this.concurrency,
      this.planner,
      this.adapters,
      this.metrics,
      m => this.resolveKey(m),
      m => this.hasCredential(m),
      this.now
    );
  }

  registerModel(def: ModelDefinition): void {
    this.registry.register(def);
  }

  registerAdapter(provider: string, adapter: ProviderAdapter): void {
    this.adapters.register(provider, adapter);
  }

  on(event: RouterEventType, listener: RouterEventListener): () => void {
    return this.metrics.on(event, listener);
  }

  off(event: RouterEventType, listener: RouterEventListener): void {
    this.metrics.off(event, listener);
  }

  stats(): RouterStats {
    return this.metrics.snapshot(id => this.health.getCircuitSnapshot(id));
  }

  explain(params: ChatCompletionCreateParams, options?: RequestExecutionOptions): ExplainResult {
    const candidates = options?.models
      ? options.models.map(m => this.registry.resolve(m))
      : this.configuredModels;
    const normalized = normalizeRequest(params, options);
    const strategy = options?.strategy ?? this.config.strategy ?? 'priority';
    const sessionRemaining =
      this.config.budget?.maxSessionCostUsd !== undefined
        ? Math.max(0, this.config.budget.maxSessionCostUsd - this.metrics.getSessionReportedCostUsd())
        : undefined;

    const plan = this.planner.plan({
      candidates,
      strategy,
      request: normalized,
      health: this.health,
      metrics: this.metrics,
      privacy: options?.privacy ?? this.config.privacy,
      maxEstimatedCostUsd: options?.budget?.maxEstimatedCostUsd ?? this.config.budget?.maxEstimatedCostUsd,
      sessionRemainingBudgetUsd: sessionRemaining,
      hasKeyFn: m => this.hasCredential(m),
      allowExploration: false
    });

    return this.planner.toExplainResult(plan, normalized);
  }

  private resolveKey(model: ModelDefinition): string | undefined {
    const provider = model.provider.toLowerCase();
    if (this.config.apiKeys?.[provider]) return this.config.apiKeys[provider];
    if (this.config.providers?.[provider]?.apiKey) return this.config.providers[provider].apiKey;

    if (typeof process !== 'undefined' && process.env) {
      if (model.apiKeyEnv && process.env[model.apiKeyEnv]) return process.env[model.apiKeyEnv];
      const endpointEnv = this.config.providers?.[provider]?.apiKeyEnv;
      if (endpointEnv && process.env[endpointEnv]) return process.env[endpointEnv];
      switch (provider) {
        case 'openai': return process.env.OPENAI_API_KEY;
        case 'anthropic': return process.env.ANTHROPIC_API_KEY;
        case 'groq': return process.env.GROQ_API_KEY;
        case 'gemini': return process.env.GEMINI_API_KEY;
        case 'openrouter': return process.env.OPENROUTER_API_KEY;
        case 'together': return process.env.TOGETHER_API_KEY;
        case 'deepseek': return process.env.DEEPSEEK_API_KEY;
        case 'mistral': return process.env.MISTRAL_API_KEY;
      }
    }
    return undefined;
  }

  private hasCredential(_model: ModelDefinition): boolean {
    return true;
  }

  public chat = {
    completions: {
      create: this.createCompletion.bind(this) as {
        (
          params: ChatCompletionCreateParams & { stream: true },
          options?: RequestExecutionOptions
        ): Promise<AsyncGenerator<ChatCompletionChunk, void, unknown>>;
        (
          params: ChatCompletionCreateParams & { stream?: false },
          options?: RequestExecutionOptions
        ): Promise<ChatCompletionResponse>;
        (
          params: ChatCompletionCreateParams,
          options?: RequestExecutionOptions
        ): Promise<ChatCompletionResponse | AsyncGenerator<ChatCompletionChunk, void, unknown>>;
      }
    }
  };

  private createCompletion(
    params: ChatCompletionCreateParams,
    options?: RequestExecutionOptions
  ): Promise<ChatCompletionResponse | AsyncGenerator<ChatCompletionChunk, void, unknown>> {
    const candidates = options?.models
      ? options.models.map(m => this.registry.resolve(m))
      : this.configuredModels;
    const normalized = normalizeRequest(params, options);

    if (params.stream) return this.engine.executeStream(candidates, normalized, options);
    return this.engine.executeNonStream(candidates, normalized, options);
  }
}
