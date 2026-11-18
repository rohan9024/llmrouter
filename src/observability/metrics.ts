import {
  ModelRuntimeStats,
  RouterEventListener,
  RouterEventPayload,
  RouterEventType,
  RouterStats
} from '../types.js';

interface InternalModelMetrics {
  id: string;
  provider: string;
  attempts: number;
  successes: number;
  failures: number;
  rateLimits: number;
  latencies: number[];
  ttfts: number[];
  tpsSamples: number[];
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx]);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

const MAX_SAMPLES = 200;

export class MetricsTracker {
  private requests = 0;
  private successfulRequests = 0;
  private failedRequests = 0;
  private fallbackRequests = 0;
  private retryCount = 0;
  private totalEstimatedCostUsd = 0;
  private totalReportedUsageCostUsd = 0;
  private requestLatencies: number[] = [];
  private modelMetrics = new Map<string, InternalModelMetrics>();
  private listeners = new Map<RouterEventType, Set<RouterEventListener>>();
  private globalListeners = new Set<RouterEventListener>();

  on(event: RouterEventType | '*', listener: RouterEventListener): () => void {
    if (event === '*') {
      this.globalListeners.add(listener);
      return () => this.globalListeners.delete(listener);
    }
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => this.off(event, listener);
  }

  off(event: RouterEventType | '*', listener: RouterEventListener): void {
    if (event === '*') {
      this.globalListeners.delete(listener);
      return;
    }
    this.listeners.get(event)?.delete(listener);
  }

  emit(payload: RouterEventPayload): void {
    for (const fn of this.globalListeners) {
      try {
        fn(payload);
      } catch {}
    }
    const set = this.listeners.get(payload.type);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch {}
    }
  }

  private getOrCreateModel(id: string, provider: string): InternalModelMetrics {
    let m = this.modelMetrics.get(id);
    if (!m) {
      m = { id, provider, attempts: 0, successes: 0, failures: 0, rateLimits: 0, latencies: [], ttfts: [], tpsSamples: [] };
      this.modelMetrics.set(id, m);
    }
    return m;
  }

  private pushSample(arr: number[], value: number): void {
    arr.push(value);
    if (arr.length > MAX_SAMPLES) arr.shift();
  }

  recordAttemptSuccess(params: { id: string; provider: string; latencyMs: number; ttftMs?: number; outputTokens?: number }): void {
    const m = this.getOrCreateModel(params.id, params.provider);
    m.attempts += 1;
    m.successes += 1;
    this.pushSample(m.latencies, params.latencyMs);
    if (params.ttftMs !== undefined) this.pushSample(m.ttfts, params.ttftMs);
    if (params.outputTokens && params.latencyMs > 0) {
      this.pushSample(m.tpsSamples, (params.outputTokens / params.latencyMs) * 1000);
    }
  }

  recordAttemptFailure(params: { id: string; provider: string; latencyMs: number; isRateLimit: boolean }): void {
    const m = this.getOrCreateModel(params.id, params.provider);
    m.attempts += 1;
    m.failures += 1;
    if (params.isRateLimit) m.rateLimits += 1;
    this.pushSample(m.latencies, params.latencyMs);
  }

  recordRequestOutcome(params: {
    success: boolean;
    fallbackUsed: boolean;
    retryCount: number;
    latencyMs: number;
    estimatedCostUsd?: number;
    reportedUsageCostUsd?: number;
  }): void {
    this.requests += 1;
    if (params.success) this.successfulRequests += 1;
    else this.failedRequests += 1;
    if (params.fallbackUsed) this.fallbackRequests += 1;
    this.retryCount += params.retryCount;
    if (params.estimatedCostUsd) this.totalEstimatedCostUsd += params.estimatedCostUsd;
    if (params.reportedUsageCostUsd) this.totalReportedUsageCostUsd += params.reportedUsageCostUsd;
    this.pushSample(this.requestLatencies, params.latencyMs);
  }

  getModelSampleCount(id: string): number {
    return this.modelMetrics.get(id)?.attempts ?? 0;
  }

  getModelObservedLatencyMs(id: string): number | undefined {
    const m = this.modelMetrics.get(id);
    return m && m.latencies.length > 0 ? average(m.latencies) : undefined;
  }

  getModelFailureRate(id: string): number {
    const m = this.modelMetrics.get(id);
    return !m || m.attempts === 0 ? 0 : m.failures / m.attempts;
  }

  getSessionReportedCostUsd(): number {
    return this.totalReportedUsageCostUsd > 0 ? this.totalReportedUsageCostUsd : this.totalEstimatedCostUsd;
  }

  snapshot(healthFn: (id: string) => { circuitState: 'closed' | 'open' | 'half-open'; cooldownUntil?: number }): RouterStats {
    const perModel: Record<string, ModelRuntimeStats> = {};
    for (const [id, m] of this.modelMetrics.entries()) {
      const health = healthFn(id);
      perModel[id] = {
        id: m.id,
        provider: m.provider,
        attempts: m.attempts,
        successes: m.successes,
        failures: m.failures,
        rateLimits: m.rateLimits,
        averageLatencyMs: average(m.latencies),
        p50LatencyMs: percentile(m.latencies, 50),
        p95LatencyMs: percentile(m.latencies, 95),
        averageTtftMs: average(m.ttfts),
        tokensPerSecond: average(m.tpsSamples),
        circuitState: health.circuitState,
        cooldownUntil: health.cooldownUntil
      };
    }
    return {
      requests: this.requests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
      fallbackRequests: this.fallbackRequests,
      retryCount: this.retryCount,
      totalEstimatedCostUsd: Number(this.totalEstimatedCostUsd.toFixed(6)),
      totalReportedUsageCostUsd: Number(this.totalReportedUsageCostUsd.toFixed(6)),
      averageLatencyMs: average(this.requestLatencies),
      p50LatencyMs: percentile(this.requestLatencies, 50),
      p95LatencyMs: percentile(this.requestLatencies, 95),
      perModel
    };
  }
}
