import { RouterConfig, RouterEventPayload, RouterEventType, RouterEventListener } from './types.js';

export class TelemetryManager {
  private readonly listeners = new Map<RouterEventType, Set<RouterEventListener>>();
  private readonly globalListeners = new Set<RouterEventListener>();

  constructor(private readonly config?: RouterConfig) {}

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
    // Also support legacy or config-level telemetry hooks if provided
    if (payload.type === 'success' || payload.type === 'failure') {
      // Request complete event
    }
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
}
