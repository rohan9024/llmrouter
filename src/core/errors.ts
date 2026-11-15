import { AttemptRecord, RouterErrorCode, RouterErrorInfo } from '../types.js';
import { redactSecrets } from '../observability/redact.js';

export class RouterError extends Error implements RouterErrorInfo {
  public readonly code: RouterErrorCode;
  public readonly provider: string;
  public readonly model: string;
  public readonly status?: number;
  public readonly providerCode?: string;
  public readonly retryable: boolean;
  public readonly failoverEligible: boolean;
  public readonly retryAfterMs?: number;
  public readonly cooldownMs?: number;
  public readonly requestId: string;

  constructor(info: RouterErrorInfo) {
    const safeMessage = redactSecrets(info.message);
    super(`[${info.code}] ${info.provider}/${info.model}: ${safeMessage}`);
    this.name = 'RouterError';
    this.code = info.code;
    this.message = safeMessage;
    this.provider = info.provider;
    this.model = info.model;
    this.status = info.status;
    this.providerCode = info.providerCode;
    this.retryable = info.retryable;
    this.failoverEligible = info.failoverEligible;
    this.retryAfterMs = info.retryAfterMs;
    this.cooldownMs = info.cooldownMs;
    this.requestId = info.requestId;
  }

  toJSON(): RouterErrorInfo {
    return {
      code: this.code,
      message: this.message,
      provider: this.provider,
      model: this.model,
      status: this.status,
      providerCode: this.providerCode,
      retryable: this.retryable,
      failoverEligible: this.failoverEligible,
      retryAfterMs: this.retryAfterMs,
      cooldownMs: this.cooldownMs,
      requestId: this.requestId
    };
  }
}

export class AllProvidersFailedError extends Error {
  public readonly requestId: string;
  public readonly errors: RouterErrorInfo[];
  public readonly attempts: AttemptRecord[];

  constructor(requestId: string, errors: RouterErrorInfo[], attempts: AttemptRecord[] = []) {
    const summary = errors
      .map(e => `[${e.provider}/${e.model}] (${e.code}${e.status ? `:${e.status}` : ''}) ${redactSecrets(e.message)}`)
      .join('; ');
    super(`All eligible LLM providers failed (requestId=${requestId}): ${summary || 'No eligible providers'}`);
    this.name = 'AllProvidersFailedError';
    this.requestId = requestId;
    this.errors = errors;
    this.attempts = attempts;
  }
}

export function parseRetryAfterMs(headers?: Headers): number | undefined {
  if (!headers) return undefined;
  const retryAfterMsHeader = headers.get('retry-after-ms');
  if (retryAfterMsHeader) {
    const ms = Number(retryAfterMsHeader);
    if (!Number.isNaN(ms) && ms >= 0) return Math.min(ms, 120_000);
  }
  const retryAfter = headers.get('retry-after');
  if (!retryAfter) return undefined;
  const secs = Number(retryAfter);
  if (!Number.isNaN(secs) && secs >= 0) return Math.min(Math.round(secs * 1000), 120_000);
  const parsedDate = Date.parse(retryAfter);
  if (!Number.isNaN(parsedDate)) return Math.min(Math.max(0, parsedDate - Date.now()), 120_000);
  return undefined;
}
