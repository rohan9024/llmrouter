import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../src/router.js';
import { AllProvidersFailedError } from '../src/core/errors.js';

describe('Router Reliability Engine', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('retries same target on transient 503 before falling back', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('Temporary outage', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'chatcmpl_1',
            choices: [{ index: 0, message: { role: 'assistant', content: 'Recovered!' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
          }),
          { status: 200 }
        )
      );

    global.fetch = mockFetch;
    const router = new Router({
      models: ['openai/gpt-5-mini', 'anthropic/claude-sonnet-5-5'],
      retry: { maxRetriesPerTarget: 1, baseDelayMs: 1, maxDelayMs: 5, jitter: 'none' }
    });

    const res = await router.chat.completions.create({ messages: [{ role: 'user', content: 'Hi' }] });

    expect(res.choices[0].message.content).toBe('Recovered!');
    expect(res._routerMeta.retryCount).toBe(1);
    expect(res._routerMeta.fallbackUsed).toBe(false);
    expect(res._routerMeta.attemptCount).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('skips target with 401 AUTHENTICATION without retrying same target and succeeds on backup', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Invalid API key', code: 'invalid_api_key' } }), {
          status: 401
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'msg_1',
            content: [{ type: 'text', text: 'Backup Anthropic succeeded' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 5, output_tokens: 4 }
          }),
          { status: 200 }
        )
      );

    global.fetch = mockFetch;
    const router = new Router({
      models: ['openai/gpt-5-mini', 'anthropic/claude-sonnet-5-5'],
      retry: { maxRetriesPerTarget: 2, baseDelayMs: 1 }
    });

    const res = await router.chat.completions.create({ messages: [{ role: 'user', content: 'Hi' }] });
    expect(res.choices[0].message.content).toBe('Backup Anthropic succeeded');
    expect(res._routerMeta.fallbackUsed).toBe(true);
    expect(res._routerMeta.retryCount).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('applies cooldown on 429 without poisoning circuit breaker and opens circuit on infra failures', async () => {
    let now = 1_000_000;
    const mockFetch = vi.fn().mockImplementation(async url => {
      if (String(url).includes('openai')) {
        return new Response('Rate limited', { status: 429, headers: { 'retry-after': '10' } });
      }
      return new Response(
        JSON.stringify({
          id: 'msg_ok',
          content: [{ type: 'text', text: 'From Claude' }],
          stop_reason: 'end_turn'
        }),
        { status: 200 }
      );
    });

    global.fetch = mockFetch;
    const router = new Router({
      models: ['openai/gpt-5-mini', 'anthropic/claude-sonnet-5-5'],
      retry: { maxRetriesPerTarget: 0 },
      circuitBreaker: { failureThreshold: 2, openDurationMs: 5000 },
      now: () => now
    });

    // 1st request: OpenAI returns 429 with Retry-After: 10s -> cooldown applied, circuit remains closed
    await router.chat.completions.create({ messages: [{ role: 'user', content: '1' }] });
    let stats = router.stats();
    expect(stats.perModel['openai/gpt-5-mini'].circuitState).toBe('closed');
    expect(stats.perModel['openai/gpt-5-mini'].cooldownUntil).toBe(now + 10_000);

    // 2nd request while cooldown active: OpenAI skipped immediately
    await router.chat.completions.create({ messages: [{ role: 'user', content: '2' }] });
    expect(mockFetch).toHaveBeenCalledTimes(3); // 2 calls req1 + 1 call req2

    // Advance past cooldown & make OpenAI fail with 500 twice to open circuit
    now += 15_000;
    global.fetch = vi.fn().mockImplementation(async url => {
      if (String(url).includes('openai')) {
        return new Response('Outage', { status: 500 });
      }
      return new Response(
        JSON.stringify({
          id: 'msg_ok',
          content: [{ type: 'text', text: 'Claude backup' }],
          stop_reason: 'end_turn'
        }),
        { status: 200 }
      );
    });

    await router.chat.completions.create({ messages: [{ role: 'user', content: '3' }] });
    await router.chat.completions.create({ messages: [{ role: 'user', content: '4' }] });
    stats = router.stats();
    expect(stats.perModel['openai/gpt-5-mini'].circuitState).toBe('open');

    // Advance past openDurationMs -> half-open probe recovers circuit
    now += 6000;
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'chatcmpl_recovered',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Back up' }, finish_reason: 'stop' }]
        }),
        { status: 200 }
      )
    );
    const recovered = await router.chat.completions.create({ messages: [{ role: 'user', content: '5' }] });
    expect(recovered._routerMeta.modelUsed).toBe('openai/gpt-5-mini');
    expect(router.stats().perModel['openai/gpt-5-mini'].circuitState).toBe('closed');
  });

  it('stops immediately on caller AbortSignal and does not fail over on CONTENT_POLICY', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    global.fetch = vi.fn();

    const router = new Router(['openai/gpt-5-mini', 'anthropic/claude-sonnet-5-5']);
    await expect(
      router.chat.completions.create({ messages: [{ role: 'user', content: 'Hi' }] }, { signal: ctrl.signal })
    ).rejects.toThrow(AllProvidersFailedError);
    expect(global.fetch).not.toHaveBeenCalled();

    const policyFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'content_filter', message: 'Blocked' } }), { status: 400 })
    );
    global.fetch = policyFetch;
    await expect(
      router.chat.completions.create({ messages: [{ role: 'user', content: 'bad' }] })
    ).rejects.toThrow(AllProvidersFailedError);
    expect(policyFetch).toHaveBeenCalledTimes(1);
  });
});