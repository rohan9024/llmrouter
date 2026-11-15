---
name: llmrouter-migration
description: Use when migrating existing Node.js or TypeScript code from direct openai, @anthropic-ai/sdk, or @google/genai SDK calls to @rohan9024/llmrouter for failover and resilience.
license: MIT
metadata:
  author: rohan9024
  package: "@rohan9024/llmrouter"
---

# Migrate Direct SDK Calls to LLMRouter

1. Scan safely with `npx @rohan9024/llmrouter migrate --json`.
2. Install `@rohan9024/llmrouter`.
3. Replace direct `new OpenAI()` / `new Anthropic()` clients with a shared server-side `Router` instance.
4. Keep existing `chat.completions.create(...)` call sites unchanged; remove redundant manual `try/catch` provider loops.
5. Run `npx @rohan9024/llmrouter doctor --json`, typecheck, and unit tests.