
# @rohan9024/llmrouter Quickstart

## Basic Setup

```typescript
import { Router } from '@rohan9024/llmrouter';

export const llm = new Router({
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

const response = await llm.chat.completions.create({
  messages: [
    {
      role: 'system',
      content: 'Be concise.',
    },
    {
      role: 'user',
      content: 'Explain circuit breakers.',
    },
  ],
});
```
