# llmrouter

A zero-runtime-dependency, in-process LLM router with ordered provider fallback.

> **Status:** early-stage project. Review provider API compatibility and test against your own accounts before production use.

## Features

- In-process routing; no proxy server or Docker service.
- Ordered fallback across OpenAI, Anthropic, Groq, Google Gemini's OpenAI-compatible endpoint, and local Ollama.
- OpenAI-style chat request and response shape.
- Anthropic request/response translation.
- Retry on rate limits, server errors, network errors, and timeouts.
- Streaming support with fallback if stream setup or the first chunk fails.
- Native `fetch`; no runtime SDK dependencies.

## Requirements

- Node.js 18+ (Node.js 20+ recommended).
- API keys for the hosted providers you use.
- `fetch` and `AbortSignal.timeout` support.

## Install

```bash
npm install llmrouter
```

## Quick start

```ts
import { Router } from 'llmrouter';

const router = new Router({
  models: [
    'openai/gpt-4o',
    'anthropic/claude-3-7-sonnet',
    'groq/llama-3.3-70b-versatile'
  ],
  timeoutMs: 30000
});

const response = await router.chat.completions.create({
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Explain quantum computing.' }
  ]
});

if (Symbol.asyncIterator in Object(response)) {
  throw new Error('Expected a non-streaming response');
}

console.log(response.choices[0].message.content);
console.log(response._routerMeta);
```

## API keys

Set environment variables before starting your app:

```bash
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export GROQ_API_KEY="..."
export GEMINI_API_KEY="..."
```

Or pass keys explicitly:

```ts
const router = new Router({
  models: ['openai/gpt-4o', 'anthropic/claude-3-7-sonnet'],
  apiKeys: {
    openai: process.env.OPENAI_API_KEY ?? '',
    anthropic: process.env.ANTHROPIC_API_KEY ?? ''
  }
});
```

Ollama normally does not require an API key.

## Streaming

```ts
const stream = await router.chat.completions.create({
  messages: [{ role: 'user', content: 'Write a short poem.' }],
  stream: true
});

if (Symbol.asyncIterator in Object(stream)) {
  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
  }
}
```

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

## Important limitations

- Fallback occurs for request failures and, for streaming, failures before the first chunk. Once stream content has been delivered, the router cannot transparently restart on another provider without risking duplicated or inconsistent output.
- Provider models do not have identical capabilities, context limits, pricing, or output behavior.
- The current implementation targets text chat messages. Tool calling, multimodal inputs, provider-specific options, and exact token-usage parity are not normalized.
- Gemini uses Google's OpenAI-compatible endpoint; confirm current endpoint/model support and API-key requirements.
- The library does not guarantee sub-50ms failover. A failed request may wait for its timeout or provider response before moving to the next provider.
- Never expose API keys in client-side/browser code. Use this library from a trusted server environment.

## License

MIT