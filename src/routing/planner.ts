import {
  AdaptiveConfig,
  BalancedWeights,
  ExplainCandidate,
  ExplainResult,
  ModelDefinition,
  PrivacyConstraints,
  RoutingStrategyName
} from '../types.js';
import { NormalizedRequest } from '../core/request.js';
import { HealthManager } from '../reliability/health.js';
import { MetricsTracker } from '../observability/metrics.js';
import { filterEligibleModels } from './capability-filter.js';

export interface PlannedCandidate {
  model: ModelDefinition;
  estimatedCostUsd?: number;
  observedLatencyMs?: number;
  score?: number;
  healthState: 'closed' | 'open' | 'half-open' | 'cooldown';
  selectionReason: string;
}

export interface RoutePlan {
  strategy: RoutingStrategyName;
  ordered: PlannedCandidate[];
  rejected: ExplainResult['rejected'];
  reasons: string[];
}

const DEFAULT_WEIGHTS: BalancedWeights = { cost: 0.4, latency: 0.35, reliability: 0.25 };

export class RoutingPlanner {
  private readonly minSamples: number;
  private readonly explorationRate: number;
  private readonly weights: BalancedWeights;
  private readonly randomFn: () => number;

  constructor(adaptive?: AdaptiveConfig) {
    this.minSamples = adaptive?.minSamples ?? 5;
    this.explorationRate = adaptive?.explorationRate ?? 0.05;
    this.weights = { ...DEFAULT_WEIGHTS, ...adaptive?.weights };
    this.randomFn = adaptive?.randomFn ?? Math.random;
  }

  plan(params: {
    candidates: ModelDefinition[];
    strategy: RoutingStrategyName;
    request: NormalizedRequest;
    health: HealthManager;
    metrics: MetricsTracker;
    privacy?: PrivacyConstraints;
    maxEstimatedCostUsd?: number;
    sessionRemainingBudgetUsd?: number;
    hasKeyFn: (model: ModelDefinition) => boolean;
    allowExploration?: boolean;
  }): RoutePlan {
    const { eligible, rejected } = filterEligibleModels({
      candidates: params.candidates,
      request: params.request,
      health: params.health,
      privacy: params.privacy,
      maxEstimatedCostUsd: params.maxEstimatedCostUsd,
      sessionRemainingBudgetUsd: params.sessionRemainingBudgetUsd,
      hasKeyFn: params.hasKeyFn
    });

    if (eligible.length === 0) {
      return {
        strategy: params.strategy,
        ordered: [],
        rejected,
        reasons: ['No eligible models satisfied capability, privacy, budget, and health constraints.']
      };
    }

    let ordered: PlannedCandidate[] = eligible.map((item, idx) => ({
      model: item.model,
      estimatedCostUsd: item.estimatedCostUsd,
      observedLatencyMs: params.metrics.getModelObservedLatencyMs(item.model.id),
      healthState: item.healthState,
      selectionReason: `Priority rank #${idx + 1}`
    }));

    const reasons: string[] = [
      `Filtered ${params.candidates.length} configured targets down to ${eligible.length} eligible candidate(s)`
    ];

    if (params.strategy === 'priority') {
      reasons.push('Selected configured priority order');
    } else if (params.strategy === 'weighted') {
      ordered = this.orderWeighted(ordered);
      reasons.push('Selected primary target via configured weights');
    } else if (params.strategy === 'lowest-cost') {
      ordered.sort((a, b) => (a.estimatedCostUsd ?? Infinity) - (b.estimatedCostUsd ?? Infinity));
      ordered.forEach(c => {
        c.selectionReason =
          c.estimatedCostUsd !== undefined ? `Lowest estimated cost ($${c.estimatedCostUsd.toFixed(6)})` : 'Unknown pricing fallback';
      });
      reasons.push('Ordered eligible candidates by lowest estimated request cost');
    } else if (params.strategy === 'lowest-latency') {
      const hasEnoughSamples = ordered.every(c => params.metrics.getModelSampleCount(c.model.id) >= this.minSamples);
      if (hasEnoughSamples) {
        ordered.sort((a, b) => (a.observedLatencyMs ?? Infinity) - (b.observedLatencyMs ?? Infinity));
        ordered.forEach(c => {
          c.selectionReason = `Observed average latency ${c.observedLatencyMs ?? 0}ms`;
        });
        reasons.push('Ordered eligible candidates by lowest observed latency');
      } else {
        reasons.push(`Cold-start guard active (< ${this.minSamples} samples); preserved priority order`);
      }
    } else if (params.strategy === 'health-aware') {
      ordered.sort((a, b) => params.metrics.getModelFailureRate(a.model.id) - params.metrics.getModelFailureRate(b.model.id));
      ordered.forEach(c => {
        const rate = params.metrics.getModelFailureRate(c.model.id);
        c.selectionReason = `Failure rate ${(rate * 100).toFixed(1)}% (${c.healthState})`;
      });
      reasons.push('Ordered eligible candidates by lowest failure rate and circuit health');
    } else if (params.strategy === 'balanced') {
      const scored = this.scoreBalanced(ordered, params.metrics);
      const hasEnoughSamples = ordered.every(c => params.metrics.getModelSampleCount(c.model.id) >= this.minSamples);
      if (hasEnoughSamples) {
        ordered = scored;
        if (params.allowExploration && ordered.length > 1 && this.randomFn() < this.explorationRate) {
          const exploreIdx = 1 + Math.floor(this.randomFn() * (ordered.length - 1));
          const [picked] = ordered.splice(exploreIdx, 1);
          picked.selectionReason = 'Controlled exploration sample';
          ordered.unshift(picked);
          reasons.push('Controlled exploration triggered');
        } else {
          reasons.push('Lowest balanced score across cost, latency, and reliability');
        }
      } else {
        ordered = ordered.map((c, idx) => ({
          ...c,
          score: scored.find(s => s.model.id === c.model.id)?.score,
          selectionReason: `Cold-start priority #${idx + 1} (collecting >= ${this.minSamples} samples)`
        }));
        reasons.push(`Cold-start guard active (< ${this.minSamples} samples); used configured priority`);
      }
    }

    return { strategy: params.strategy, ordered, rejected, reasons };
  }

  private orderWeighted(candidates: PlannedCandidate[]): PlannedCandidate[] {
    const pool = [...candidates];
    const result: PlannedCandidate[] = [];
    while (pool.length > 0) {
      const totalWeight = pool.reduce((sum, item) => sum + Math.max(0.01, item.model.weight ?? 1), 0);
      let r = this.randomFn() * totalWeight;
      let pickedIdx = 0;
      for (let i = 0; i < pool.length; i++) {
        r -= Math.max(0.01, pool[i].model.weight ?? 1);
        if (r <= 0) {
          pickedIdx = i;
          break;
        }
      }
      const [chosen] = pool.splice(pickedIdx, 1);
      chosen.selectionReason = `Weighted draw (weight=${chosen.model.weight ?? 1})`;
      result.push(chosen);
    }
    return result;
  }

  private scoreBalanced(candidates: PlannedCandidate[], metrics: MetricsTracker): PlannedCandidate[] {
    const maxCost = Math.max(...candidates.map(c => c.estimatedCostUsd ?? 0), 1e-9);
    const maxLatency = Math.max(...candidates.map(c => c.observedLatencyMs ?? 1000), 1);
    return candidates
      .map(c => {
        const normCost = (c.estimatedCostUsd ?? maxCost) / maxCost;
        const normLatency = (c.observedLatencyMs ?? maxLatency) / maxLatency;
        const failureRisk = metrics.getModelFailureRate(c.model.id);
        const score = Number(
          (this.weights.cost * normCost + this.weights.latency * normLatency + this.weights.reliability * failureRisk).toFixed(4)
        );
        return {
          ...c,
          score,
          selectionReason: `Balanced score ${score} (cost=${normCost.toFixed(2)}, lat=${normLatency.toFixed(2)}, risk=${failureRisk.toFixed(2)})`
        };
      })
      .sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  }

  toExplainResult(plan: RoutePlan, request: NormalizedRequest): ExplainResult {
    const selected = plan.ordered[0]?.model.id ?? null;
    const candidates: ExplainCandidate[] = plan.ordered.map(c => ({
      model: c.model.id,
      provider: c.model.provider,
      estimatedCostUsd: c.estimatedCostUsd,
      observedLatencyMs: c.observedLatencyMs,
      score: c.score,
      healthState: c.healthState
    }));
    const reason: string[] = [];
    if (request.requiredCapabilities.tools) reason.push('Supports required tool calling');
    if (request.requiredCapabilities.vision) reason.push('Supports required vision input');
    if (request.requiredCapabilities.structuredOutput) reason.push('Supports structured JSON output');
    reason.push(`Fits estimated input (${request.estimatedInputTokens} tokens)`);
    reason.push(...plan.reasons);

    return {
      selected,
      strategy: plan.strategy,
      reason,
      candidates,
      rejected: plan.rejected,
      estimatedInputTokens: request.estimatedInputTokens,
      requiredCapabilities: request.requiredCapabilities
    };
  }
}
