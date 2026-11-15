import { ChatCompletionChunk } from '../types.js';

export interface SSEEvent {
  event?: string;
  data: string;
}

export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<SSEEvent, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent: string | undefined;
  let dataLines: string[] = [];

  const abortHandler = () => {
    reader.cancel().catch(() => {});
  };

  if (signal) {
    if (signal.aborted) {
      await reader.cancel().catch(() => {});
      return;
    }
    signal.addEventListener('abort', abortHandler, { once: true });
  }

  const flushEvent = (): SSEEvent | null => {
    if (dataLines.length === 0) {
      currentEvent = undefined;
      return null;
    }
    const evt: SSEEvent = { event: currentEvent, data: dataLines.join('\n') };
    currentEvent = undefined;
    dataLines = [];
    return evt;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line === '') {
          const evt = flushEvent();
          if (evt) yield evt;
          continue;
        }
        if (line.startsWith(':')) continue;
        const colonIdx = line.indexOf(':');
        const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
        let val = colonIdx === -1 ? '' : line.slice(colonIdx + 1);
        if (val.startsWith(' ')) val = val.slice(1);
        if (field === 'event') currentEvent = val;
        else if (field === 'data') dataLines.push(val);
      }
    }

    buffer += decoder.decode();
    if (buffer.length > 0) {
      for (const line of buffer.split(/\r?\n/)) {
        if (line === '') {
          const evt = flushEvent();
          if (evt) yield evt;
        } else if (line.startsWith('data:')) {
          const val = line.slice(5);
          dataLines.push(val.startsWith(' ') ? val.slice(1) : val);
        }
      }
    }

    const tail = flushEvent();
    if (tail) yield tail;
  } finally {
    if (signal) signal.removeEventListener('abort', abortHandler);
    reader.releaseLock();
  }
}

export function chunkHasMeaningfulOutput(chunk: ChatCompletionChunk): boolean {
  if (!chunk.choices || chunk.choices.length === 0) return false;
  return chunk.choices.some(
    c =>
      (typeof c.delta?.content === 'string' && c.delta.content.length > 0) ||
      (Array.isArray(c.delta?.tool_calls) && c.delta.tool_calls.length > 0) ||
      Boolean(c.finish_reason)
  );
}
