import { ExplainRejection, ModelCapabilities, ModelDefinition, PrivacyConstraints } from '../types.js';
import { estimateModelCostUsd, NormalizedRequest } from '../core/request.js';
import { HealthManager } from '../reliability/health.js';

export interface EligibilityResult {
  eligible: Array<{
    model: ModelDefinition;
    estimatedCostUsd?: number;
    healthState: 'closed' | 'open' | 'half-open' | 'cooldown';
  }>;
  rejected: ExplainRejection[];
}

export function filterEligibleModels(params: {
  candidates: ModelDefinition[];
  request: NormalizedRequest;
  health: HealthManager;
  privacy?: PrivacyConstraints;
  maxEstimatedCostUsd?: number;
  sessionRemainingBudgetUsd?: number;
  hasKeyFn: (model: ModelDefinition) => boolean;
}): EligibilityResult {
  const { candidates, request, health, privacy, maxEstimatedCostUsd, sessionRemainingBudgetUsd, hasKeyFn } = params;
  const eligible: EligibilityResult['eligible'] = [];
  const rejected: ExplainRejection[] = [];

  for (const model of candidates) {
    if (!hasKeyFn(model)) {
      rejected.push({ model: model.id, code: 'MISSING_CREDENTIAL', reason: `No API key configured for "${model.provider}"` });
      continue;
    }
    if (privacy?.allowedProviders && !privacy.allowedProviders.includes(model.provider)) {
      rejected.push({ model: model.id, code: 'PRIVACY_PROVIDER_NOT_ALLOWED', reason: `Provider "${model.provider}" not in allowedProviders` });
      continue;
    }
    if (privacy?.blockedProviders && privacy.blockedProviders.includes(model.provider)) {
      rejected.push({ model: model.id, code: 'PRIVACY_PROVIDER_BLOCKED', reason: `Provider "${model.provider}" blocked by policy` });
      continue;
    }
    if (privacy?.zeroDataRetentionOnly && model.privacy.zeroDataRetention !== true) {
      rejected.push({
        model: model.id,
        code: 'PRIVACY_ZDR_REQUIRED',
        reason: `Zero data retention required (status: ${String(model.privacy.zeroDataRetention)})`
      });
      continue;
    }
    if (privacy?.allowedRegions && privacy.allowedRegions.length > 0) {
      const regions = model.privacy.dataResidency ?? [];
      if (!regions.some(r => privacy.allowedRegions!.includes(r))) {
        rejected.push({ model: model.id, code: 'PRIVACY_REGION_MISMATCH', reason: `Required residency (${privacy.allowedRegions.join(',')}) not attested` });
        continue;
      }
    }

    let capRejection: string | null = null;
    for (const [cap, required] of Object.entries(request.requiredCapabilities)) {
      if (required && !model.capabilities[cap as keyof ModelCapabilities]) {
        capRejection = `Required capability "${cap}" unsupported`;
        break;
      }
    }
    if (capRejection) {
      rejected.push({ model: model.id, code: 'UNSUPPORTED_CAPABILITY', reason: capRejection });
      continue;
    }

    if (model.contextWindow && request.estimatedInputTokens > model.contextWindow) {
      rejected.push({
        model: model.id,
        code: 'CONTEXT_WINDOW_EXCEEDED',
        reason: `Estimated ${request.estimatedInputTokens} input tokens exceeds contextWindow (${model.contextWindow})`
      });
      continue;
    }

    const estCost = estimateModelCostUsd(model, request.estimatedInputTokens, request.expectedOutputTokens);
    if (maxEstimatedCostUsd !== undefined && estCost !== undefined && estCost > maxEstimatedCostUsd) {
      rejected.push({
        model: model.id,
        code: 'BUDGET_EXCEEDED',
        reason: `Estimated cost $${estCost.toFixed(6)} exceeds maxEstimatedCostUsd $${maxEstimatedCostUsd.toFixed(6)}`
      });
      continue;
    }
    if (sessionRemainingBudgetUsd !== undefined && estCost !== undefined && estCost > sessionRemainingBudgetUsd) {
      rejected.push({
        model: model.id,
        code: 'SESSION_BUDGET_EXCEEDED',
        reason: `Estimated cost $${estCost.toFixed(6)} exceeds remaining session budget $${sessionRemainingBudgetUsd.toFixed(6)}`
      });
      continue;
    }

    const healthStatus = health.getStatus(model.id);
    if (!healthStatus.available) {
      rejected.push({
        model: model.id,
        code: healthStatus.healthState === 'cooldown' ? 'COOLDOWN_ACTIVE' : 'CIRCUIT_OPEN',
        reason: healthStatus.reason ?? `Target unavailable (${healthStatus.healthState})`
      });
      continue;
    }

    eligible.push({ model, estimatedCostUsd: estCost, healthState: healthStatus.healthState });
  }

  return { eligible, rejected };
}
