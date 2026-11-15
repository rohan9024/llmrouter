---
name: llmrouter-debug
description: Use when debugging provider failovers, unexpected model selections, circuit-breaker openings, rate-limit cooldowns, or streaming issues with @rohan9024/llmrouter.
license: MIT
metadata:
  author: rohan9024
  package: "@rohan9024/llmrouter"
---

# Debug LLMRouter Routing & Reliability

1. Run `npx @rohan9024/llmrouter doctor --json` to check runtime, adapters, and env key presence.
2. Call `router.explain(request)` or `npx @rohan9024/llmrouter explain --json` to inspect candidate filtering (`rejected[]`).
3. Inspect `router.stats()` and attach `router.on('retry' | 'fallback' | 'cooldown' | 'circuit-open', ...)` listeners.
4. Never print raw API keys or user prompts in logs.