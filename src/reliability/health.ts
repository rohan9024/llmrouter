import { CircuitBreakerConfig } from '../types.js';
import { RouterError } from '../core/errors.js';

export interface ResolvedCircuitBreakerConfig {
  enabled: boolean;
  rollingWindowMs: number;
  failureThreshold: number;
  openDurationMs: number;
  halfOpenProbes: number;
}

export const DEFAULT_CIRCUIT_CONFIG: ResolvedCircuitBreakerConfig = {
  enabled: true,
  rollingWindowMs: 60_000,
  failureThreshold: 5,
  openDurationMs: 30_000,
  halfOpenProbes: 1
};

type CircuitState = 'closed' | 'open' | 'half-open';

interface TargetCircuitRecord {
  state: CircuitState;
  failureTimestamps: number[];
  openedAt: number;
  halfOpenInFlight: number;
}

export class HealthManager {
  private readonly cfg: ResolvedCircuitBreakerConfig;
  private readonly now: () => number;
  private readonly circuits = new Map<string, TargetCircuitRecord>();
  private readonly cooldowns = new Map<string, { until: number; reason: string }>();

  constructor(cfg?: CircuitBreakerConfig, now: () => number = Date.now) {
    this.cfg = { ...DEFAULT_CIRCUIT_CONFIG, ...cfg };
    this.now = now;
  }

  private getCircuit(id: string): TargetCircuitRecord {
    let rec = this.circuits.get(id);
    if (!rec) {
      rec = { state: 'closed', failureTimestamps: [], openedAt: 0, halfOpenInFlight: 0 };
      this.circuits.set(id, rec);
    }
    return rec;
  }

  getStatus(id: string): {
    available: boolean;
    healthState: 'closed' | 'open' | 'half-open' | 'cooldown';
    reason?: string;
    cooldownUntil?: number;
  } {
    const t = this.now();
    const cd = this.cooldowns.get(id);
    if (cd) {
      if (t < cd.until) {
        return { available: false, healthState: 'cooldown', reason: cd.reason, cooldownUntil: cd.until };
      }
      this.cooldowns.delete(id);
    }

    if (!this.cfg.enabled) return { available: true, healthState: 'closed' };

    const rec = this.getCircuit(id);
    if (rec.state === 'open') {
      if (t >= rec.openedAt + this.cfg.openDurationMs) {
        rec.state = 'half-open';
        rec.halfOpenInFlight = 0;
      } else {
        return {
          available: false,
          healthState: 'open',
          reason: `Circuit breaker open until ${new Date(rec.openedAt + this.cfg.openDurationMs).toISOString()}`
        };
      }
    }

    if (rec.state === 'half-open') {
      if (rec.halfOpenInFlight >= this.cfg.halfOpenProbes) {
        return { available: false, healthState: 'half-open', reason: 'Circuit breaker half-open probe in progress' };
      }
      return { available: true, healthState: 'half-open' };
    }

    return { available: true, healthState: 'closed' };
  }

  acquireDispatch(id: string): boolean {
    const status = this.getStatus(id);
    if (!status.available) return false;
    const rec = this.getCircuit(id);
    if (rec.state === 'half-open') rec.halfOpenInFlight += 1;
    return true;
  }

  releaseHalfOpenProbe(id: string): void {
    const rec = this.circuits.get(id);
    if (rec && rec.state === 'half-open' && rec.halfOpenInFlight > 0) rec.halfOpenInFlight -= 1;
  }

  recordSuccess(id: string): { circuitClosed: boolean } {
    this.cooldowns.delete(id);
    const rec = this.getCircuit(id);
    const wasOpenOrHalf = rec.state !== 'closed';
    rec.state = 'closed';
    rec.failureTimestamps = [];
    rec.openedAt = 0;
    rec.halfOpenInFlight = 0;
    return { circuitClosed: wasOpenOrHalf };
  }

  recordFailure(id: string, error: RouterError): { circuitOpened: boolean; cooldownAppliedMs?: number } {
    const t = this.now();
    this.releaseHalfOpenProbe(id);

    if (error.code === 'RATE_LIMITED') {
      const cdMs = error.cooldownMs ?? error.retryAfterMs ?? 5000;
      this.cooldowns.set(id, { until: t + cdMs, reason: 'Temporary rate-limit cooldown' });
      return { circuitOpened: false, cooldownAppliedMs: cdMs };
    }

    if (error.code === 'AUTHENTICATION' || error.code === 'PERMISSION_DENIED' || error.code === 'MODEL_NOT_FOUND') {
      const cdMs = error.cooldownMs ?? 60_000;
      this.cooldowns.set(id, { until: t + cdMs, reason: `Deployment cooldown (${error.code})` });
      return { circuitOpened: false, cooldownAppliedMs: cdMs };
    }

    if (!this.cfg.enabled) return { circuitOpened: false };
    if (
      error.code !== 'PROVIDER_UNAVAILABLE' &&
      error.code !== 'TIMEOUT' &&
      error.code !== 'NETWORK_ERROR' &&
      error.code !== 'INVALID_RESPONSE'
    ) {
      return { circuitOpened: false };
    }

    const rec = this.getCircuit(id);
    if (rec.state === 'half-open') {
      rec.state = 'open';
      rec.openedAt = t;
      rec.halfOpenInFlight = 0;
      return { circuitOpened: true };
    }

    rec.failureTimestamps.push(t);
    const windowStart = t - this.cfg.rollingWindowMs;
    rec.failureTimestamps = rec.failureTimestamps.filter(ts => ts >= windowStart);

    if (rec.failureTimestamps.length >= this.cfg.failureThreshold) {
      rec.state = 'open';
      rec.openedAt = t;
      return { circuitOpened: true };
    }
    return { circuitOpened: false };
  }

  getCircuitSnapshot(id: string): { circuitState: 'closed' | 'open' | 'half-open'; cooldownUntil?: number } {
    const status = this.getStatus(id);
    const rec = this.circuits.get(id);
    return { circuitState: rec ? rec.state : 'closed', cooldownUntil: status.cooldownUntil };
  }
}
