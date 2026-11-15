import { RetryConfig } from '../types.js';
import { RouterError } from '../core/errors.js';

export interface ResolvedRetryConfig {
  maxRetriesPerTarget: number;
  maxTotalAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: 'full' | 'equal' | 'none';
  respectRetryAfter: boolean;
  maxRetryAfterMs: number;
  retryOnTimeout: boolean;
}

export const DEFAULT_RETRY_CONFIG: ResolvedRetryConfig = {
  maxRetriesPerTarget: 1,
  maxTotalAttempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 4000,
  jitter: 'full',
  respectRetryAfter: true,
  maxRetryAfterMs: 5000,
  retryOnTimeout: true
};

export function resolveRetryConfig(cfg?: RetryConfig): ResolvedRetryConfig {
  return { ...DEFAULT_RETRY_CONFIG, ...cfg };
}

export class RetryController {
  private readonly cfg: ResolvedRetryConfig;
  private readonly randomFn: () => number;

  constructor(cfg?: RetryConfig, randomFn: () => number = Math.random) {
    this.cfg = resolveRetryConfig(cfg);
    this.randomFn = randomFn;
  }

  get maxRetriesPerTarget(): number {
    return this.cfg.maxRetriesPerTarget;
  }

  get maxTotalAttempts(): number {
    return this.cfg.maxTotalAttempts;
  }

  shouldRetrySameTarget(
    error: RouterError,
    retriesForTargetSoFar: number,
    totalAttemptsSoFar: number,
    remainingDeadlineMs: number
  ): { retry: boolean; delayMs: number } {
    if (totalAttemptsSoFar >= this.cfg.maxTotalAttempts) return { retry: false, delayMs: 0 };
    if (retriesForTargetSoFar >= this.cfg.maxRetriesPerTarget) return { retry: false, delayMs: 0 };
    if (!error.retryable) return { retry: false, delayMs: 0 };
    if (error.code === 'TIMEOUT' && !this.cfg.retryOnTimeout) return { retry: false, delayMs: 0 };
    if (error.retryAfterMs && error.retryAfterMs > this.cfg.maxRetryAfterMs) return { retry: false, delayMs: 0 };

    const delayMs = this.computeDelayMs(retriesForTargetSoFar, error.retryAfterMs);
    if (delayMs >= remainingDeadlineMs) return { retry: false, delayMs: 0 };
    return { retry: true, delayMs };
  }

  computeDelayMs(retryAttemptIndex: number, retryAfterMs?: number): number {
    if (this.cfg.respectRetryAfter && retryAfterMs !== undefined && retryAfterMs >= 0) {
      return Math.min(retryAfterMs, this.cfg.maxRetryAfterMs);
    }
    const exp = Math.min(this.cfg.maxDelayMs, this.cfg.baseDelayMs * Math.pow(2, retryAttemptIndex));
    if (this.cfg.jitter === 'none') return exp;
    if (this.cfg.jitter === 'equal') {
      const half = exp / 2;
      return Math.round(half + this.randomFn() * half);
    }
    return Math.round(this.randomFn() * exp);
  }
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
