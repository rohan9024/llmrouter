import { describe, it, expect, vi, afterEach } from 'vitest';
import { Router } from '../src/router.js';
import { AllProvidersFailedError } from '../src/errors.js';

describe('Router failover engine', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  it('fails over from a rate-limited provider to Anthropic', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response('Rate limit exceeded', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'msg_123',
        content: [{ type: 'text', text: 'Hello from Claude!' }],
        usage: { input_tokens: 10, output_tokens: 5 }
      }), { status: 200 }));
    global.fetch = mockFetch;

    const router = new Router(['openai/gpt-4o', 'anthropic/claude-3-7-sonnet']);
    const result = await router.chat.completions.create({
      messages: [{ role: 'user', content: 'Hi' }]
    }) as any;

    expect(result.choices[0].message.content).toBe('Hello from Claude!');
    expect(result._routerMeta.providerUsed).toBe('anthropic/claude-3-7-sonnet');
    expect(result._routerMeta.attempts).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws when all configured providers fail', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('Internal Server Error', { status: 500 })
    );
    const router = new Router(['openai/gpt-4o', 'groq/llama-3.3-70b-versatile']);
    await expect(router.chat.completions.create({
      messages: [{ role: 'user', content: 'Ping' }]
    })).rejects.toThrowError(AllProvidersFailedError);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});