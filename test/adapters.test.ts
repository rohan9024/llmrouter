import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnthropicAdapter } from '../src/adapters/anthropic.js';
import { OpenAICompatAdapter } from '../src/adapters/openai-compat.js';
import { GeminiAdapter } from '../src/adapters/gemini.js';
import { normalizeRequest } from '../src/core/request.js';

describe('Provider Adapters & Error Classification', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('translates system, developer, images, tools, and consecutive tool_results for Anthropic', async () => {
    let capturedBody: any;
    let capturedHeaders: any;

    global.fetch = vi.fn().mockImplementation(async (_url, opts) => {
      capturedHeaders = opts.headers;
      capturedBody = JSON.parse(opts.body as string);
      return new Response(
        JSON.stringify({
          id: 'msg_tool',
          content: [
            { type: 'text', text: 'Checking weather.' },
            { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Berlin' } }
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 100, output_tokens: 30, cache_read_input_tokens: 40 }
        }),
        { status: 200 }
      );
    });

    const adapter = new AnthropicAdapter();
    const req = normalizeRequest({
      messages: [
        { role: 'system', content: 'Be helpful.' },
        { role: 'developer', content: 'Use tools.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this photo?' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }
          ]
        },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 't1', type: 'function', function: { name: 'a', arguments: '{"x":1}' } }]
        },
        { role: 'tool', tool_call_id: 't1', content: 'res1' },
        { role: 'tool', tool_call_id: 't2', content: 'res2' }
      ],
      tools: [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object' } } }],
      tool_choice: 'required'
    });

    const res = await adapter.execute(req, {
      target: {
        id: 'anthropic/claude-sonnet-5-5',
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        capabilities: { text: true, vision: true, tools: true, structuredOutput: true, audioInput: false, audioOutput: false, reasoning: true },
        privacy: { zeroDataRetention: 'unknown' }
      },
      apiKey: 'sk-ant-test',
      signal: AbortSignal.timeout(5000),
      requestId: 'req-1'
    });

    expect(capturedHeaders['x-api-key']).toBe('sk-ant-test');
    expect(capturedBody.system).toBe('Be helpful.\n\nUse tools.');
    expect(capturedBody.tool_choice).toEqual({ type: 'any' });
    expect(capturedBody.messages[0].content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' }
    });
    // Consecutive tool responses merged into a single user message
    expect(capturedBody.messages[2].role).toBe('user');
    expect(capturedBody.messages[2].content).toHaveLength(2);
    expect(res.choices[0].finish_reason).toBe('tool_calls');
    expect(res.choices[0].message.tool_calls?.[0].function.name).toBe('get_weather');
    expect(res.usage?.prompt_tokens_details?.cached_tokens).toBe(40);
  });

  it('sanitizes developer role for non-OpenAI compat endpoints and classifies Gemini errors', async () => {
    let bodySent: any;
    global.fetch = vi.fn().mockImplementation(async (_u, opts) => {
      bodySent = JSON.parse(opts.body as string);
      return new Response(
        JSON.stringify({
          id: 'groq_1',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
        }),
        { status: 200 }
      );
    });

    const compat = new OpenAICompatAdapter();
    await compat.execute(
      normalizeRequest({ messages: [{ role: 'developer', content: 'Rule' }, { role: 'user', content: 'Hi' }] }),
      {
        target: {
          id: 'groq/llama-3.3-70b-versatile',
          provider: 'groq',
          model: 'llama-3.3-70b-versatile',
          capabilities: { text: true, vision: false, tools: true, structuredOutput: false, audioInput: false, audioOutput: false, reasoning: false },
          privacy: { zeroDataRetention: 'unknown' }
        },
        signal: AbortSignal.timeout(5000),
        requestId: 'req-2'
      }
    );
    expect(bodySent.messages[0].role).toBe('system');

    const gemini = new GeminiAdapter();
    const err = gemini.classifyError(new Error('RESOURCE_EXHAUSTED: quota exceeded'), {
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      requestId: 'req-3',
      status: 429
    });
    expect(err.code).toBe('RATE_LIMITED');
  });
});