import { describe, it, expect, vi, afterEach } from 'vitest';
import { Router } from '../src/router.js';
import { RouterError } from '../src/core/errors.js';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(enc.encode(c));
      ctrl.close();
    }
  });
}

describe('Streaming Normalization & Safety', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('handles split SSE frames and fails over cleanly before content is exposed', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('Overloaded', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          streamFromChunks([
            'event: message_start\r\ndata: {"type":"message_start","message":{"id":"m1","model":"claude-sonnet-5-5","usage":{"input_tokens":12}}}\r\n\r\n',
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel',
            'lo "}}\n\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_9","name":"ping"}}\n\n',
            'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"a\\":1}"}}\n\n',
            'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}\n\n'
          ]),
          { status: 200 }
        )
      );

    const router = new Router({
      models: ['openai/gpt-5-mini', 'anthropic/claude-sonnet-5-5'],
      retry: { maxRetriesPerTarget: 0 }
    });

    const stream = await router.chat.completions.create({
      messages: [{ role: 'user', content: 'test' }],
      stream: true
    });

    const received: any[] = [];
    for await (const chunk of stream) {
      received.push(chunk);
    }

    expect(received[0].choices[0].delta.content).toBe('Hello ');
    expect(received[1].choices[0].delta.tool_calls[0].function.name).toBe('ping');
    expect(received[2].choices[0].delta.tool_calls[0].function.arguments).toBe('{"a":1}');
    expect(received[3].choices[0].finish_reason).toBe('tool_calls');
    expect(received[3].usage?.total_tokens).toBe(21);
  });

  it('surfaces error after content is yielded instead of silently restarting', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        streamFromChunks([
          'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-5-mini","choices":[{"index":0,"delta":{"content":"Part 1"}}]}\n\n',
          'data: {"error":{"message":"Mid-stream failure"}}\n\n'
        ]),
        { status: 200 }
      )
    );

    const router = new Router(['openai/gpt-5-mini', 'anthropic/claude-sonnet-5-5']);
    const stream = await router.chat.completions.create({
      messages: [{ role: 'user', content: 'test' }],
      stream: true
    });

    const chunks: string[] = [];
    await expect(async () => {
      for await (const c of stream) {
        if (c.choices[0]?.delta?.content) chunks.push(c.choices[0].delta.content);
      }
    }).rejects.toThrow(RouterError);

    expect(chunks).toEqual(['Part 1']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});