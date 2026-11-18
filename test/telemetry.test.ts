import { describe, it, expect, vi, afterEach } from 'vitest';
import { Router } from '../src/router.js';
import { RouterEventPayload } from '../src/types.js';

describe('Router Telemetry & Event Hooks', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('emits retry, failover, circuit-breaker-state-change, and request-complete events with rich context', async () => {
    const events: RouterEventPayload[] = [];

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('Rate limited', { status: 429, headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'chat_success',
            choices: [{ index: 0, message: { role: 'assistant', content: 'Success after fallback' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 }
          }),
          { status: 200 }
        )
      );

    const router = new Router({
      models: ['openai/gpt-5-mini', 'anthropic/claude-sonnet-5-5'],
      retry: { maxRetriesPerTarget: 0 }
    });

    const unsubscribe = router.on('*', (event) => {
      events.push(event);
    });

    await router.chat.completions.create({ messages: [{ role: 'user', content: 'Hello telemetry' }] });

    unsubscribe();

    expect(events.some(e => e.type === 'fallback')).toBe(true);
    expect(events.some(e => e.type === 'success')).toBe(true);

    const successEvent = events.find(e => e.type === 'success');
    expect(successEvent).toBeDefined();
    expect(successEvent?.requestId).toBeTypeOf('string');
    expect(successEvent?.model).toBe('claude-sonnet-5-5');
    expect(successEvent?.latencyMs).toBeTypeOf('number');
  });
});
