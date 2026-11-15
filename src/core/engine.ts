import { randomUUID } from 'node:crypto';
import {
  AttemptRecord,
  ChatCompletionChunk,
  ChatCompletionResponse,
  ModelDefinition,
  RequestExecutionOptions,
  RouterConfig,
  RouterErrorInfo,
  RoutingStrategyName
} from '../types.js';
import { AllProvidersFailedError, RouterError } from './errors.js';
import { estimateModelCostUsd, NormalizedRequest } from './request.js';
import { chunkHasMeaningfulOutput } from './stream.js';
import { abortableSleep, RetryController } from '../reliability/retry.js';
import { HealthManager } from '../reliability/health.js';
import { ConcurrencyLimiter } from '../reliability/concurrency.js';
import { RoutingPlanner } from '../routing/planner.js';
import { AdapterRegistry } from '../adapters/index.js';
import { MetricsTracker } from '../observability/metrics.js';

function composeSignals(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) {
      controller.abort(sig.reason);
      return controller.signal;
    }
    sig.addEventListener('abort', () => controller.abort(sig.reason), { once: true });
  }
  return controller.signal;
}

function createAttemptSignal(
  callerSignal: AbortSignal | undefined,
  perAttemptMs: number,
  remainingTotalMs: number
): { signal: AbortSignal; cleanup: () => void; timedOutByTotal: () => boolean } {
  const timeoutCtrl = new AbortController();
  const effectiveMs = Math.max(1, Math.min(perAttemptMs, remainingTotalMs));
  const hitTotal = remainingTotalMs <= perAttemptMs;
  const timer = setTimeout(() => {
    timeoutCtrl.abort(new DOMException(`Timed out after ${effectiveMs}ms`, 'TimeoutError'));
  }, effectiveMs);
  const combined = composeSignals(callerSignal ? [callerSignal, timeoutCtrl.signal] : [timeoutCtrl.signal]);
  return {
    signal: combined,
    cleanup: () => clearTimeout(timer),
    timedOutByTotal: () => timeoutCtrl.signal.aborted && hitTotal
  };
}

export class ExecutionEngine {
  constructor(
    private readonly config: RouterConfig,
    private readonly retry: RetryController,
    private readonly health: HealthManager,
    private readonly concurrency: ConcurrencyLimiter,
    private readonly planner: RoutingPlanner,
    private readonly adapters: AdapterRegistry,
    private readonly metrics: MetricsTracker,
    private readonly resolveKey: (model: ModelDefinition) => string | undefined,
    private readonly hasKey: (model: ModelDefinition) => boolean,
    private readonly now: () => number
  ) {}

  private getDeadlines(options?: RequestExecutionOptions): { totalMs: number; perAttemptMs: number } {
    const totalMs = options?.timeoutMs ?? this.config.timeout?.totalTimeoutMs ?? this.config.timeoutMs ?? 30_000;
    const perAttemptMs = options?.perAttemptMs ?? this.config.timeout?.perAttemptMs ?? Math.min(10_000, totalMs);
    return { totalMs, perAttemptMs };
  }

  private getRemainingSessionBudget(): number | undefined {
    const cap = this.config.budget?.maxSessionCostUsd;
    if (cap === undefined) return undefined;
    return Math.max(0, cap - this.metrics.getSessionReportedCostUsd());
  }

  async executeNonStream(
    candidates: ModelDefinition[],
    request: NormalizedRequest,
    options?: RequestExecutionOptions
  ): Promise<ChatCompletionResponse> {
    const requestId = randomUUID();
    const strategy: RoutingStrategyName = options?.strategy ?? this.config.strategy ?? 'priority';
    const { totalMs, perAttemptMs } = this.getDeadlines(options);
    const startMs = this.now();
    const deadlineAt = startMs + totalMs;

    const span = this.config.telemetry?.startSpan?.('llmrouter.request', { requestId, strategy, stream: false });
    const plan = this.planner.plan({
      candidates,
      strategy,
      request,
      health: this.health,
      metrics: this.metrics,
      privacy: options?.privacy ?? this.config.privacy,
      maxEstimatedCostUsd: options?.budget?.maxEstimatedCostUsd ?? this.config.budget?.maxEstimatedCostUsd,
      sessionRemainingBudgetUsd: this.getRemainingSessionBudget(),
      hasKeyFn: this.hasKey,
      allowExploration: true
    });

    const errors: RouterErrorInfo[] = [];
    const attempts: AttemptRecord[] = [];
    let totalAttempts = 0;
    let totalRetries = 0;

    if (plan.ordered.length === 0) {
      const noEligibleErr = new RouterError({
        code: plan.rejected.some(r => r.code.includes('BUDGET')) ? 'BUDGET_EXCEEDED' : 'INVALID_REQUEST',
        message: plan.rejected.map(r => `${r.model}: ${r.reason}`).join('; ') || 'No eligible models',
        provider: 'router',
        model: 'none',
        retryable: false,
        failoverEligible: false,
        requestId
      });
      this.metrics.recordRequestOutcome({ success: false, fallbackUsed: false, retryCount: 0, latencyMs: 0 });
      this.metrics.emit({ type: 'failure', requestId, timestamp: this.now(), errorCode: noEligibleErr.code, message: noEligibleErr.message, strategy });
      span?.end({ success: false }, noEligibleErr);
      throw new AllProvidersFailedError(requestId, [noEligibleErr.toJSON()], attempts);
    }

    for (let targetIdx = 0; targetIdx < plan.ordered.length; targetIdx++) {
      const planned = plan.ordered[targetIdx];
      const target = planned.model;
      const endpointCfg = this.config.providers?.[target.provider];
      const adapter = this.adapters.resolve(target.provider, endpointCfg);
      const apiKey = this.resolveKey(target);
      let targetRetries = 0;

      while (true) {
        if (options?.signal?.aborted) {
          const cancelErr = new RouterError({
            code: 'CANCELLED',
            message: 'Caller aborted request',
            provider: target.provider,
            model: target.model,
            retryable: false,
            failoverEligible: false,
            requestId
          });
          errors.push(cancelErr.toJSON());
          this.metrics.recordRequestOutcome({ success: false, fallbackUsed: targetIdx > 0, retryCount: totalRetries, latencyMs: this.now() - startMs });
          span?.end({ success: false }, cancelErr);
          throw new AllProvidersFailedError(requestId, errors, attempts);
        }

        const remainingTotal = deadlineAt - this.now();
        if (remainingTotal <= 0) {
          const timeoutErr = new RouterError({
            code: 'TIMEOUT',
            message: `Total request deadline (${totalMs}ms) exceeded`,
            provider: target.provider,
            model: target.model,
            retryable: false,
            failoverEligible: false,
            requestId
          });
          errors.push(timeoutErr.toJSON());
          this.metrics.recordRequestOutcome({ success: false, fallbackUsed: targetIdx > 0, retryCount: totalRetries, latencyMs: this.now() - startMs });
          span?.end({ success: false }, timeoutErr);
          throw new AllProvidersFailedError(requestId, errors, attempts);
        }

        if (!this.health.acquireDispatch(target.id)) break;

        totalAttempts += 1;
        const attemptStart = this.now();
        this.metrics.emit({
          type: 'attempt',
          requestId,
          timestamp: attemptStart,
          target: target.id,
          provider: target.provider,
          model: target.model,
          attemptNumber: totalAttempts,
          retryNumber: targetRetries,
          strategy
        });

        let releaseConcurrency: (() => void) | undefined;
        const { signal, cleanup, timedOutByTotal } = createAttemptSignal(options?.signal, perAttemptMs, remainingTotal);

        try {
          releaseConcurrency = await this.concurrency.acquire(target.provider, target.id, target.maxConcurrency, signal);
          const rawRes = await adapter.execute(request, {
            target,
            apiKey,
            endpointConfig: endpointCfg,
            signal,
            requestId,
            idempotencyKey: options?.idempotencyKey
          });

          const latencyMs = Math.max(0, this.now() - attemptStart);
          const totalLatencyMs = Math.max(0, this.now() - startMs);
          const { circuitClosed } = this.health.recordSuccess(target.id);

          if (circuitClosed) {
            this.metrics.emit({ type: 'circuit-close', requestId, timestamp: this.now(), target: target.id, provider: target.provider, model: target.model });
          }

          const reportedUsageCostUsd = rawRes.usage
            ? estimateModelCostUsd(target, rawRes.usage.prompt_tokens, rawRes.usage.completion_tokens, rawRes.usage.prompt_tokens_details?.cached_tokens ?? 0)
            : undefined;

          this.metrics.recordAttemptSuccess({ id: target.id, provider: target.provider, latencyMs, outputTokens: rawRes.usage?.completion_tokens });
          attempts.push({
            target: target.id,
            provider: target.provider,
            model: target.model,
            attemptNumber: totalAttempts,
            retryNumber: targetRetries,
            status: 'success',
            latencyMs,
            estimatedCostUsd: planned.estimatedCostUsd,
            reportedUsageCostUsd
          });
          this.metrics.recordRequestOutcome({
            success: true,
            fallbackUsed: targetIdx > 0,
            retryCount: totalRetries,
            latencyMs: totalLatencyMs,
            estimatedCostUsd: planned.estimatedCostUsd,
            reportedUsageCostUsd
          });
          this.metrics.emit({
            type: 'success',
            requestId,
            timestamp: this.now(),
            target: target.id,
            provider: target.provider,
            model: target.model,
            attemptNumber: totalAttempts,
            latencyMs: totalLatencyMs,
            estimatedCostUsd: planned.estimatedCostUsd,
            reportedUsageCostUsd
          });

          const { verifiedBilledCostUsd, ...cleanRes } = rawRes;
          const finalResponse: ChatCompletionResponse = {
            ...cleanRes,
            _routerMeta: {
              requestId,
              providerUsed: target.provider,
              modelUsed: target.id,
              attemptCount: totalAttempts,
              retryCount: totalRetries,
              fallbackUsed: targetIdx > 0,
              totalLatencyMs,
              routeStrategy: strategy,
              routeReason: planned.selectionReason,
              estimatedCostUsd: planned.estimatedCostUsd,
              reportedUsageCostUsd,
              verifiedBilledCostUsd,
              attempts
            }
          };
          span?.end({ success: true, modelUsed: target.id, attempts: totalAttempts });
          return finalResponse;
        } catch (err) {
          const latencyMs = Math.max(0, this.now() - attemptStart);
          const classified = err instanceof RouterError ? err : adapter.classifyError(err, { provider: target.provider, model: target.model, requestId });
          const effectiveError =
            classified.code === 'CANCELLED' && !options?.signal?.aborted
              ? new RouterError({
                  ...classified.toJSON(),
                  code: 'TIMEOUT',
                  message: timedOutByTotal() ? `Total request deadline (${totalMs}ms) exceeded` : `Attempt timed out after ${perAttemptMs}ms`,
                  retryable: !timedOutByTotal(),
                  failoverEligible: !timedOutByTotal()
                })
              : classified;

          errors.push(effectiveError.toJSON());
          attempts.push({
            target: target.id,
            provider: target.provider,
            model: target.model,
            attemptNumber: totalAttempts,
            retryNumber: targetRetries,
            status: 'failed',
            latencyMs,
            errorCode: effectiveError.code,
            httpStatus: effectiveError.status,
            errorMessage: effectiveError.message
          });

          this.metrics.recordAttemptFailure({ id: target.id, provider: target.provider, latencyMs, isRateLimit: effectiveError.code === 'RATE_LIMITED' });
          const healthOutcome = this.health.recordFailure(target.id, effectiveError);
          if (healthOutcome.circuitOpened) {
            this.metrics.emit({ type: 'circuit-open', requestId, timestamp: this.now(), target: target.id, provider: target.provider, model: target.model, errorCode: effectiveError.code });
          }
          if (healthOutcome.cooldownAppliedMs) {
            this.metrics.emit({ type: 'cooldown', requestId, timestamp: this.now(), target: target.id, provider: target.provider, model: target.model, cooldownMs: healthOutcome.cooldownAppliedMs, errorCode: effectiveError.code });
          }

          if (effectiveError.code === 'CANCELLED' || !effectiveError.failoverEligible) {
            this.metrics.recordRequestOutcome({ success: false, fallbackUsed: targetIdx > 0, retryCount: totalRetries, latencyMs: this.now() - startMs });
            this.metrics.emit({ type: 'failure', requestId, timestamp: this.now(), target: target.id, errorCode: effectiveError.code, message: effectiveError.message });
            span?.end({ success: false }, effectiveError);
            throw new AllProvidersFailedError(requestId, errors, attempts);
          }

          const retryDecision = this.retry.shouldRetrySameTarget(effectiveError, targetRetries, totalAttempts, deadlineAt - this.now());
          if (retryDecision.retry) {
            targetRetries += 1;
            totalRetries += 1;
            this.metrics.emit({ type: 'retry', requestId, timestamp: this.now(), target: target.id, provider: target.provider, model: target.model, retryNumber: targetRetries, errorCode: effectiveError.code });
            await abortableSleep(retryDecision.delayMs, options?.signal).catch(() => {});
            continue;
          }

          if (targetIdx + 1 < plan.ordered.length && totalAttempts < this.retry.maxTotalAttempts) {
            this.metrics.emit({ type: 'fallback', requestId, timestamp: this.now(), target: plan.ordered[targetIdx + 1].model.id, provider: target.provider, model: target.model, errorCode: effectiveError.code });
          }
          break;
        } finally {
          cleanup();
          releaseConcurrency?.();
        }
      }

      if (totalAttempts >= this.retry.maxTotalAttempts) break;
    }

    const totalLatencyMs = Math.max(0, this.now() - startMs);
    this.metrics.recordRequestOutcome({ success: false, fallbackUsed: plan.ordered.length > 1, retryCount: totalRetries, latencyMs: totalLatencyMs });
    this.metrics.emit({ type: 'failure', requestId, timestamp: this.now(), latencyMs: totalLatencyMs, errorCode: errors[errors.length - 1]?.code, message: 'All eligible providers failed' });
    const finalErr = new AllProvidersFailedError(requestId, errors, attempts);
    span?.end({ success: false }, finalErr);
    throw finalErr;
  }

  async executeStream(
    candidates: ModelDefinition[],
    request: NormalizedRequest,
    options?: RequestExecutionOptions
  ): Promise<AsyncGenerator<ChatCompletionChunk, void, unknown>> {
    const requestId = randomUUID();
    const strategy: RoutingStrategyName = options?.strategy ?? this.config.strategy ?? 'priority';
    const { totalMs, perAttemptMs } = this.getDeadlines(options);
    const startMs = this.now();
    const deadlineAt = startMs + totalMs;

    const plan = this.planner.plan({
      candidates,
      strategy,
      request,
      health: this.health,
      metrics: this.metrics,
      privacy: options?.privacy ?? this.config.privacy,
      maxEstimatedCostUsd: options?.budget?.maxEstimatedCostUsd ?? this.config.budget?.maxEstimatedCostUsd,
      sessionRemainingBudgetUsd: this.getRemainingSessionBudget(),
      hasKeyFn: this.hasKey,
      allowExploration: true
    });

    const errors: RouterErrorInfo[] = [];
    const attempts: AttemptRecord[] = [];
    let totalAttempts = 0;
    let totalRetries = 0;

    if (plan.ordered.length === 0) {
      throw new AllProvidersFailedError(requestId, [
        new RouterError({
          code: 'INVALID_REQUEST',
          message: plan.rejected.map(r => `${r.model}: ${r.reason}`).join('; ') || 'No eligible models',
          provider: 'router',
          model: 'none',
          retryable: false,
          failoverEligible: false,
          requestId
        }).toJSON()
      ]);
    }

    for (let targetIdx = 0; targetIdx < plan.ordered.length; targetIdx++) {
      const planned = plan.ordered[targetIdx];
      const target = planned.model;
      const endpointCfg = this.config.providers?.[target.provider];
      const adapter = this.adapters.resolve(target.provider, endpointCfg);
      const apiKey = this.resolveKey(target);
      let targetRetries = 0;

      while (true) {
        const remainingTotal = deadlineAt - this.now();
        if (options?.signal?.aborted || remainingTotal <= 0) {
          throw new AllProvidersFailedError(requestId, errors, attempts);
        }
        if (!this.health.acquireDispatch(target.id)) break;

        totalAttempts += 1;
        const attemptStart = this.now();
        const streamAbort = new AbortController();
        const { signal, cleanup } = createAttemptSignal(
          options?.signal ? composeSignals([options.signal, streamAbort.signal]) : streamAbort.signal,
          Math.max(perAttemptMs, totalMs),
          remainingTotal
        );

        let releaseConcurrency: (() => void) | undefined;

        try {
          releaseConcurrency = await this.concurrency.acquire(target.provider, target.id, target.maxConcurrency, signal);
          const iterable = await adapter.executeStream(request, {
            target,
            apiKey,
            endpointConfig: endpointCfg,
            signal,
            requestId,
            idempotencyKey: options?.idempotencyKey
          });

          const iterator = iterable[Symbol.asyncIterator]();
          const bufferedPreChunks: ChatCompletionChunk[] = [];
          let firstMeaningful: ChatCompletionChunk | null = null;

          while (true) {
            const step = await iterator.next();
            if (step.done) break;
            if (chunkHasMeaningfulOutput(step.value)) {
              firstMeaningful = step.value;
              break;
            }
            bufferedPreChunks.push(step.value);
          }

          if (!firstMeaningful && bufferedPreChunks.length === 0) {
            cleanup();
            releaseConcurrency();
            this.health.releaseHalfOpenProbe(target.id);
            break;
          }

          const ttftMs = Math.max(0, this.now() - attemptStart);
          const health = this.health;
          const metrics = this.metrics;
          const nowFn = this.now;

          return (async function* (): AsyncGenerator<ChatCompletionChunk, void, unknown> {
            let lastUsage: ChatCompletionResponse['usage'] | undefined;
            try {
              for (const pre of bufferedPreChunks) {
                if (pre.usage) lastUsage = pre.usage;
                yield pre;
              }
              if (firstMeaningful) {
                if (firstMeaningful.usage) lastUsage = firstMeaningful.usage;
                yield firstMeaningful;
              }
              while (true) {
                const next = await iterator.next();
                if (next.done) break;
                if (next.value.usage) lastUsage = next.value.usage;
                yield next.value;
              }
              const totalLatencyMs = Math.max(0, nowFn() - startMs);
              health.recordSuccess(target.id);
              const reportedCost = lastUsage
                ? estimateModelCostUsd(target, lastUsage.prompt_tokens, lastUsage.completion_tokens, lastUsage.prompt_tokens_details?.cached_tokens ?? 0)
                : undefined;
              metrics.recordAttemptSuccess({ id: target.id, provider: target.provider, latencyMs: totalLatencyMs, ttftMs, outputTokens: lastUsage?.completion_tokens });
              metrics.recordRequestOutcome({ success: true, fallbackUsed: targetIdx > 0, retryCount: totalRetries, latencyMs: totalLatencyMs, estimatedCostUsd: planned.estimatedCostUsd, reportedUsageCostUsd: reportedCost });
            } catch (streamErr) {
              const classified = streamErr instanceof RouterError ? streamErr : adapter.classifyError(streamErr, { provider: target.provider, model: target.model, requestId });
              health.recordFailure(target.id, classified);
              metrics.recordAttemptFailure({ id: target.id, provider: target.provider, latencyMs: Math.max(0, nowFn() - attemptStart), isRateLimit: classified.code === 'RATE_LIMITED' });
              metrics.recordRequestOutcome({ success: false, fallbackUsed: targetIdx > 0, retryCount: totalRetries, latencyMs: Math.max(0, nowFn() - startMs) });
              throw classified;
            } finally {
              cleanup();
              streamAbort.abort();
              await iterator.return?.().catch(() => {});
              releaseConcurrency?.();
            }
          })();
        } catch (err) {
          cleanup();
          streamAbort.abort();
          releaseConcurrency?.();
          const classified = err instanceof RouterError ? err : adapter.classifyError(err, { provider: target.provider, model: target.model, requestId });
          errors.push(classified.toJSON());
          this.health.recordFailure(target.id, classified);
          this.metrics.recordAttemptFailure({ id: target.id, provider: target.provider, latencyMs: Math.max(0, this.now() - attemptStart), isRateLimit: classified.code === 'RATE_LIMITED' });

          if (classified.code === 'CANCELLED' || !classified.failoverEligible) {
            throw new AllProvidersFailedError(requestId, errors, attempts);
          }

          const retryDecision = this.retry.shouldRetrySameTarget(classified, targetRetries, totalAttempts, deadlineAt - this.now());
          if (retryDecision.retry) {
            targetRetries += 1;
            totalRetries += 1;
            await abortableSleep(retryDecision.delayMs, options?.signal).catch(() => {});
            continue;
          }
          break;
        }
      }

      if (totalAttempts >= this.retry.maxTotalAttempts) break;
    }

    throw new AllProvidersFailedError(requestId, errors, attempts);
  }
}
