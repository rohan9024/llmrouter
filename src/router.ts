import type {
  ChatCompletionCreateParams,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ParsedTarget,
  RouterConfig
} from './types.js';
import type { ProviderAdapter } from './adapters/base.js';
import { OpenAICompatAdapter } from './adapters/openai-compat.js';
import { AnthropicAdapter } from './adapters/anthropic.js';
import {
  AllProvidersFailedError,
  ProviderRequestError,
  type ProviderErrorDetail
} from './errors.js';

export class Router {
  private readonly models: ParsedTarget[];
  private readonly apiKeys: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly openAICompat = new OpenAICompatAdapter();
  private readonly anthropic = new AnthropicAdapter();

  constructor(options: RouterConfig | string[]) {
    const config: RouterConfig = Array.isArray(options) ? { models: options } : options;
    if (!config.models?.length) throw new Error('Router requires at least one model configuration.');
    if (config.timeoutMs !== undefined && config.timeoutMs <= 0) {
      throw new Error('timeoutMs must be greater than zero.');
    }
    this.models = config.models.map((model) => this.parseTarget(model));
    this.apiKeys = config.apiKeys ?? {};
    this.timeoutMs = config.timeoutMs ?? 30000;
  }

  private parseTarget(raw: string): ParsedTarget {
    const slashIndex = raw.indexOf('/');
    if (slashIndex <= 0 || slashIndex === raw.length - 1) {
      throw new Error(`Invalid model target "${raw}". Use provider/model-name.`);
    }
    return {
      provider: raw.slice(0, slashIndex).toLowerCase(),
      model: raw.slice(slashIndex + 1),
      raw
    };
  }

  private resolveKey(provider: string): string | undefined {
    if (this.apiKeys[provider]) return this.apiKeys[provider];
    if (typeof process !== 'undefined' && process.env) {
      const envNames: Record<string, string> = {
        openai: 'OPENAI_API_KEY',
        anthropic: 'ANTHROPIC_API_KEY',
        groq: 'GROQ_API_KEY',
        gemini: 'GEMINI_API_KEY'
      };
      const envName = envNames[provider];
      return envName ? process.env[envName] : undefined;
    }
    return undefined;
  }

  private getAdapter(provider: string): ProviderAdapter {
    if (provider === 'anthropic') return this.anthropic;
    if (['openai', 'groq', 'ollama', 'gemini'].includes(provider)) return this.openAICompat;
    throw new ProviderRequestError(`Unsupported provider: ${provider}`, 400);
  }

  public chat = {
    completions: {
      create: (params: ChatCompletionCreateParams):
        Promise<ChatCompletionResponse | AsyncGenerator<ChatCompletionChunk, void, unknown>> => {
        if (!params.messages?.length) throw new Error('At least one chat message is required.');
        return params.stream ? this.createStream(params) : this.createNonStream(params);
      }
    }
  };

  private async createNonStream(params: ChatCompletionCreateParams): Promise<ChatCompletionResponse> {
    const errors: ProviderErrorDetail[] = [];
    const startTime = Date.now();

    for (let index = 0; index < this.models.length; index++) {
      const target = this.models[index];
      try {
        const response = await this.getAdapter(target.provider).execute(
          target, params, this.resolveKey(target.provider), this.timeoutMs
        );
        response._routerMeta = {
          providerUsed: target.raw,
          modelUsed: target.model,
          attempts: index + 1,
          latencyMs: Date.now() - startTime
        };
        return response;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push({
          target: target.raw,
          error: err.message,
          status: err instanceof ProviderRequestError ? err.status : undefined
        });
        if (err instanceof ProviderRequestError && !err.isRetryable) {
          throw new AllProvidersFailedError(errors);
        }
      }
    }
    throw new AllProvidersFailedError(errors);
  }

  private async createStream(
    params: ChatCompletionCreateParams
  ): Promise<AsyncGenerator<ChatCompletionChunk, void, unknown>> {
    const errors: ProviderErrorDetail[] = [];

    for (const target of this.models) {
      try {
        const stream = await this.getAdapter(target.provider).executeStream(
          target, params, this.resolveKey(target.provider), this.timeoutMs
        );
        const iterator = stream[Symbol.asyncIterator]();
        const first = await iterator.next();
        if (first.done) continue;

        return (async function* () {
          yield first.value;
          while (true) {
            const next = await iterator.next();
            if (next.done) break;
            yield next.value;
          }
        })();
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push({
          target: target.raw,
          error: err.message,
          status: err instanceof ProviderRequestError ? err.status : undefined
        });
      }
    }
    throw new AllProvidersFailedError(errors);
  }
}