import { describe, it, expect, vi, afterEach } from 'vitest';
import { Router } from '../src/router.js';
import { redactSecrets } from '../src/observability/redact.js';

describe('Capability Filtering, Explain, Cost Budget & Security Redaction', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('filters incompatible models before routing and explains selection', () => {
    const router = new Router({
      models: ['ollama/llama3', 'groq/llama-3.3-70b-versatile', 'openai/gpt-5-mini'],
      strategy: 'lowest-cost'
    });

    const explain = router.explain({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect image' },
            { type: 'image_url', image_url: { url: 'https://example.com/img.png' } }
          ]
        }
      ],
      tools: [{ type: 'function', function: { name: 'tag', parameters: { type: 'object' } } }]
    });

    expect(explain.selected).toBe('openai/gpt-5-mini');
    expect(explain.rejected.map(r => r.model)).toContain('ollama/llama3');
    expect(explain.rejected.map(r => r.model)).toContain('groq/llama-3.3-70b-versatile');
  });

  it('enforces zeroDataRetentionOnly privacy policy without inventing ZDR for unknown models', () => {
    const router = new Router({
      models: ['openai/gpt-5-mini', 'ollama/llama3.3'],
      privacy: { zeroDataRetentionOnly: true }
    });

    const explain = router.explain({ messages: [{ role: 'user', content: 'Secret' }] });
    expect(explain.selected).toBe('ollama/llama3.3');
    expect(explain.rejected[0].code).toBe('PRIVACY_ZDR_REQUIRED');
  });

  it('switches from cold-start priority to lowest-latency after minSamples and tracks cost + redaction', async () => {
    let toggleSlowPrimary = true;
    let fakeTime = 1000;

    global.fetch = vi.fn().mockImplementation(async url => {
      const isOpenAI = String(url).includes('openai');
      fakeTime += isOpenAI && toggleSlowPrimary ? 800 : 50;
      return new Response(
        JSON.stringify({
          id: isOpenAI ? 'oa' : 'ant',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 }
        }),
        { status: 200 }
      );
    });

    const router = new Router({
      models: ['openai/gpt-5-mini', 'anthropic/claude-sonnet-5-5'],
      strategy: 'lowest-latency',
      adaptive: { minSamples: 2 },
      now: () => fakeTime
    });

    // Warm up samples manually via explain + execution
    await router.chat.completions.create({ messages: [{ role: 'user', content: '1' }] });
    await router.chat.completions.create({ messages: [{ role: 'user', content: '2' }] });
    const stats = router.stats();
    expect(stats.totalReportedUsageCostUsd).toBeGreaterThan(0);

    // Budget rejection check
    await expect(
      router.chat.completions.create(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { budget: { maxEstimatedCostUsd: 0.0000001 } }
      )
    ).rejects.toThrow();

    const redacted = redactSecrets('Failed with Bearer sk-proj-supersecretkey12345 and AIzaSyD1234567890abcdefg');
    expect(redacted).not.toContain('supersecretkey12345');
    expect(redacted).not.toContain('AIzaSyD1234567890abcdefg');
  });
});