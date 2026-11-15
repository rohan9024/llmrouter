import { AdapterExecutionOptions } from './base.js';
import { OpenAICompatAdapter } from './openai-compat.js';
import { RouterError } from '../core/errors.js';

export class GeminiAdapter extends OpenAICompatAdapter {
  public override readonly id = 'gemini';

  protected override resolveEndpoint(options: AdapterExecutionOptions): string {
    const custom = options.target.baseUrl ?? options.endpointConfig?.baseUrl;
    if (custom) {
      const trimmed = custom.replace(/\/+$/, '');
      return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
    }
    return 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  }

  override classifyError(
    error: unknown,
    context: { provider: string; model: string; requestId: string; status?: number; headers?: Headers; bodyText?: string }
  ): RouterError {
    const base = super.classifyError(error, context);
    const lower = base.message.toLowerCase();
    if (lower.includes('resource_exhausted') || lower.includes('quota exceeded')) {
      return new RouterError({ ...base.toJSON(), code: 'RATE_LIMITED', retryable: true, failoverEligible: true, cooldownMs: base.retryAfterMs ?? 5000 });
    }
    if (lower.includes('api_key_invalid') || lower.includes('api key not valid')) {
      return new RouterError({ ...base.toJSON(), code: 'AUTHENTICATION', retryable: false, failoverEligible: true, cooldownMs: 60_000 });
    }
    if (lower.includes('safety') || lower.includes('blocked')) {
      return new RouterError({ ...base.toJSON(), code: 'CONTENT_POLICY', retryable: false, failoverEligible: false });
    }
    return base;
  }
}
