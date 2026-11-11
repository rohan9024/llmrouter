import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnthropicAdapter } from '../src/adapters/anthropic.js';

describe('Anthropic adapter payload translation', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  it('extracts system messages and maps headers and response', async () => {
    let body: any;
    let headers: any;
    global.fetch = vi.fn().mockImplementation(async (_url, options) => {
      headers = options.headers;
      body = JSON.parse(options.body as string);
      return new Response(JSON.stringify({
        id: 'msg_test',
        content: [{ type: 'text', text: 'Response received' }],
        stop_reason: 'end_turn'
      }), { status: 200 });
    }) as any;

    const adapter = new AnthropicAdapter();
    const result = await adapter.execute(
      { provider: 'anthropic', model: 'claude-3-7-sonnet', raw: 'anthropic/claude-3-7-sonnet' },
      {
        messages: [
          { role: 'system', content: 'Be concise.' },
          { role: 'user', content: 'What is 2+2?' }
        ],
        temperature: 0.7
      },
      'secret-ant-key'
    );

    expect(headers['x-api-key']).toBe('secret-ant-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(body.system).toBe('Be concise.');
    expect(body.messages).toEqual([{ role: 'user', content: 'What is 2+2?' }]);
    expect(body.temperature).toBe(0.7);
    expect(result.choices[0].message.content).toBe('Response received');
    expect(result.choices[0].finish_reason).toBe('stop');
  });
});