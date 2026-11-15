import { Router } from '../router.js';
import { ChatCompletionResponse, ChatMessage, ModelConfigInput, RouterConfig, RoutingStrategyName } from '../types.js';

export type BenchmarkValidator =
  | { type: 'json-valid' }
  | { type: 'contains'; value: string; caseSensitive?: boolean }
  | { type: 'regex'; pattern: string; flags?: string }
  | { type: 'tool-called'; name?: string }
  | { type: 'custom'; fn: (response: ChatCompletionResponse) => boolean | Promise<boolean> };

export interface BenchmarkDatasetItem {
  id: string;
  messages: ChatMessage[];
  tools?: any[];
  response_format?: any;
  validators?: BenchmarkValidator[];
}

export interface ModelBenchmarkSummary {
  model: string;
  totalCases: number;
  passedInfra: number;
  passedQuality: number;
  infraSuccessRate: number;
  qualityPassRate: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  totalReportedCostUsd: number;
  averageCostPerRequestUsd: number;
}

export interface RecommendedPolicy {
  strategy: RoutingStrategyName;
  models: Array<{ id: string; weight: number }>;
  rationale: string[];
  baselineModel: string;
}

export interface BenchmarkReport {
  timestamp: string;
  datasetSize: number;
  models: ModelBenchmarkSummary[];
  recommendedPolicy: RecommendedPolicy;
}

async function runValidator(val: BenchmarkValidator, res: ChatCompletionResponse): Promise<boolean> {
  const msg = res.choices[0]?.message;
  const text = msg?.content ?? '';
  switch (val.type) {
    case 'json-valid':
      try {
        JSON.parse(text);
        return true;
      } catch {
        return false;
      }
    case 'contains': {
      const hay = val.caseSensitive ? text : text.toLowerCase();
      const needle = val.caseSensitive ? val.value : val.value.toLowerCase();
      return hay.includes(needle);
    }
    case 'regex':
      return new RegExp(val.pattern, val.flags).test(text);
    case 'tool-called':
      if (!msg?.tool_calls || msg.tool_calls.length === 0) return false;
      return val.name ? msg.tool_calls.some(tc => tc.function.name === val.name) : true;
    case 'custom':
      return Boolean(await val.fn(res));
  }
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

export class BenchmarkRunner {
  constructor(private readonly baseConfig: Partial<RouterConfig> = {}) {}

  async run(dataset: BenchmarkDatasetItem[], models: ModelConfigInput[], options?: { minQualityRate?: number }): Promise<BenchmarkReport> {
    const summaries: ModelBenchmarkSummary[] = [];

    for (const modelInput of models) {
      const modelId = typeof modelInput === 'string' ? modelInput : modelInput.id;
      const router = new Router({ ...this.baseConfig, models: [modelInput], retry: { maxRetriesPerTarget: 0, maxTotalAttempts: 1 } });
      let passedInfra = 0;
      let passedQuality = 0;
      let totalCost = 0;
      const latencies: number[] = [];

      for (const item of dataset) {
        try {
          const res = await router.chat.completions.create({
            messages: item.messages,
            tools: item.tools,
            response_format: item.response_format
          });
          passedInfra += 1;
          latencies.push(res._routerMeta.totalLatencyMs);
          totalCost += res._routerMeta.reportedUsageCostUsd ?? res._routerMeta.estimatedCostUsd ?? 0;

          if (!item.validators || item.validators.length === 0) {
            passedQuality += 1;
          } else {
            let allPassed = true;
            for (const v of item.validators) {
              if (!(await runValidator(v, res))) {
                allPassed = false;
                break;
              }
            }
            if (allPassed) passedQuality += 1;
          }
        } catch {}
      }

      const n = Math.max(1, dataset.length);
      summaries.push({
        model: modelId,
        totalCases: dataset.length,
        passedInfra,
        passedQuality,
        infraSuccessRate: Number((passedInfra / n).toFixed(4)),
        qualityPassRate: Number((passedQuality / n).toFixed(4)),
        averageLatencyMs: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
        p95LatencyMs: Math.round(p95(latencies)),
        totalReportedCostUsd: Number(totalCost.toFixed(6)),
        averageCostPerRequestUsd: Number((totalCost / n).toFixed(6))
      });
    }

    return {
      timestamp: new Date().toISOString(),
      datasetSize: dataset.length,
      models: summaries,
      recommendedPolicy: recommendPolicyFromSummaries(summaries, options?.minQualityRate ?? 0.8)
    };
  }
}

export function recommendPolicyFromSummaries(summaries: ModelBenchmarkSummary[], minQualityRate: number = 0.8): RecommendedPolicy {
  const qualifying = summaries.filter(s => s.qualityPassRate >= minQualityRate && s.infraSuccessRate > 0);
  const pool = qualifying.length > 0 ? qualifying : [...summaries];
  const ranked = [...pool].sort((a, b) => {
    if (b.qualityPassRate !== a.qualityPassRate) return b.qualityPassRate - a.qualityPassRate;
    const costDiff = a.averageCostPerRequestUsd - b.averageCostPerRequestUsd;
    if (Math.abs(costDiff) > 1e-6) return costDiff;
    return a.averageLatencyMs - b.averageLatencyMs;
  });

  return {
    strategy: 'balanced',
    models: ranked.map((m, idx) => ({ id: m.model, weight: Math.max(1, ranked.length - idx) })),
    baselineModel: summaries[0]?.model ?? '',
    rationale: [
      `Evaluated ${summaries.length} model(s) with minimum quality threshold ${(minQualityRate * 100).toFixed(0)}%`,
      `Primary recommendation "${ranked[0]?.model ?? 'none'}" achieved ${(ranked[0]?.qualityPassRate ?? 0) * 100}% quality pass rate at avg ${ranked[0]?.averageLatencyMs ?? 0}ms`
    ]
  };
}
