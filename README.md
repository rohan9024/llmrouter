
# @rohan9024/llmrouter

**The agent-friendly reliability and routing engine for Node.js AI applications.**

In-process multi-provider routing with zero runtime dependencies, automatic failover, retries, circuit breakers, capability filtering, cost budgets, and an agent-first CLI.

## Installation

```bash
npm install @rohan9024/llmrouter
```

## AI Coding Agent Setup (Cursor, Claude Code, Codex, Copilot, Windsurf)

Install the official Agent Skill via skills.sh:

```bash
npx skills add rohan9024/llmrouter --skill llmrouter
```

Alternatively, initialize and verify directly in any Node.js project:

```bash
npx @rohan9024/llmrouter init --yes
npx @rohan9024/llmrouter doctor
```

## Quickstart

```typescript
import { Router } from '@rohan9024/llmrouter';

const router = new Router({
  models: [
    'openai/gpt-5-mini',
    'anthropic/claude-sonnet-5-5',
    'groq/openai/gpt-oss-120b',
  ],
  strategy: 'balanced',
  retry: {
    maxRetriesPerTarget: 1,
    maxTotalAttempts: 4,
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    openDurationMs: 30_000,
  },
});

const response = await router.chat.completions.create({
  messages: [
    {
      role: 'system',
      content: 'You are a helpful assistant.',
    },
    {
      role: 'user',
      content: 'Explain circuit breakers concisely.',
    },
  ],
});

console.log(response.choices[0].message.content);
console.log(response._routerMeta);
```

## Key Features

### Zero Runtime Dependencies

- Native `fetch`.
- Node.js >=22.
- Dual ESM + CommonJS support.

### Separated Reliability Engine

- Bounded per-target retries.
- Retry-After quota cooldowns.
- Circuit breakers with half-open probing.
- Concurrency caps.
- AbortSignal propagation.

### Capability-Safe Routing

Automatically prevents sending vision, tool-calling, or JSON-schema requests to incompatible models.

### Explainable Decisions

Inspect routing decisions and operational metrics using:

- `router.explain(request)`
- `router.stats()`

### Workload Benchmarking

Run benchmarks against your evaluation dataset to derive data-backed routing weights.

```bash
npx @rohan9024/llmrouter benchmark --dataset eval.jsonl --recommend-policy
```

## Documentation

- [API Reference](docs/API.md)
- [Providers & Capabilities](docs/PROVIDERS.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Migration Guide](MIGRATION.md)
- [Changelog](CHANGELOG.md)
