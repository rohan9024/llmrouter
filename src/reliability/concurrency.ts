import { ConcurrencyConfig } from '../types.js';

interface QueueEntry {
  resolve: () => void;
  reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
  signalCleanup?: () => void;
}

class Semaphore {
  private active = 0;
  private queue: QueueEntry[] = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueueSize: number,
    private readonly queueTimeoutMs: number
  ) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return this.createRelease();
    }
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error(`Concurrency queue full (maxQueueSize=${this.maxQueueSize})`);
    }

    return new Promise<() => void>((resolve, reject) => {
      const entry: QueueEntry = {
        resolve: () => {
          cleanup();
          this.active += 1;
          resolve(this.createRelease());
        },
        reject: (err: Error) => {
          cleanup();
          reject(err);
        }
      };

      const cleanup = () => {
        if (entry.timer) clearTimeout(entry.timer);
        entry.signalCleanup?.();
      };

      if (this.queueTimeoutMs > 0) {
        entry.timer = setTimeout(() => {
          const idx = this.queue.indexOf(entry);
          if (idx !== -1) this.queue.splice(idx, 1);
          entry.reject(new Error(`Concurrency queue timeout after ${this.queueTimeoutMs}ms`));
        }, this.queueTimeoutMs);
      }

      if (signal) {
        const onAbort = () => {
          const idx = this.queue.indexOf(entry);
          if (idx !== -1) this.queue.splice(idx, 1);
          entry.reject(new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        entry.signalCleanup = () => signal.removeEventListener('abort', onAbort);
      }

      this.queue.push(entry);
    });
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      const next = this.queue.shift();
      if (next) next.resolve();
    };
  }
}

export class ConcurrencyLimiter {
  private readonly cfg: ConcurrencyConfig;
  private readonly providerSemaphores = new Map<string, Semaphore>();
  private readonly modelSemaphores = new Map<string, Semaphore>();

  constructor(cfg?: ConcurrencyConfig) {
    this.cfg = cfg ?? {};
  }

  private getProviderSemaphore(provider: string): Semaphore | null {
    if (!this.cfg.maxConcurrentPerProvider) return null;
    let sem = this.providerSemaphores.get(provider);
    if (!sem) {
      sem = new Semaphore(this.cfg.maxConcurrentPerProvider, this.cfg.maxQueueSize ?? 64, this.cfg.queueTimeoutMs ?? 5000);
      this.providerSemaphores.set(provider, sem);
    }
    return sem;
  }

  private getModelSemaphore(modelId: string, overrideLimit?: number): Semaphore | null {
    const limit = overrideLimit ?? this.cfg.maxConcurrentPerModel;
    if (!limit) return null;
    let sem = this.modelSemaphores.get(modelId);
    if (!sem) {
      sem = new Semaphore(limit, this.cfg.maxQueueSize ?? 64, this.cfg.queueTimeoutMs ?? 5000);
      this.modelSemaphores.set(modelId, sem);
    }
    return sem;
  }

  async acquire(provider: string, modelId: string, modelLimitOverride?: number, signal?: AbortSignal): Promise<() => void> {
    const provSem = this.getProviderSemaphore(provider);
    const modSem = this.getModelSemaphore(modelId, modelLimitOverride);
    const releases: Array<() => void> = [];
    try {
      if (provSem) releases.push(await provSem.acquire(signal));
      if (modSem) releases.push(await modSem.acquire(signal));
      return () => {
        for (const r of releases.reverse()) r();
      };
    } catch (err) {
      for (const r of releases.reverse()) r();
      throw err;
    }
  }
}
