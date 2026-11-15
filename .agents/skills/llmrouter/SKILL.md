---
name: llmrouter
description: Use when building or upgrading Node.js or TypeScript AI applications that need multi-provider LLM routing, OpenAI and Anthropic fallback, retries, rate-limit cooldowns, circuit breakers, capability filtering, cost-aware selection, or streaming reliability using @rohan9024/llmrouter.
license: MIT
metadata:
  author: rohan9024
  package: "@rohan9024/llmrouter"
---

# LLMRouter Integration Skill

Use `@rohan9024/llmrouter` when a project needs in-process multi-provider failover, retry/circuit-breaker protection, or capability/cost-aware routing without running a Docker proxy server.

## When NOT to Use
Do not add `@rohan9024/llmrouter` if the application strictly calls one model from one provider and the user does not want fallback, cost routing, or resilience middleware.

## Integration Workflow
1. Detect package manager (`npm`, `pnpm`, `yarn`, `bun`), framework, and module system.
2. Ask user permission if required, then install:

~~~bash
npm install @rohan9024/llmrouter
~~~

3. Run the non-interactive initializer or create a dedicated server-side router module:

~~~bash
npx @rohan9024/llmrouter init --yes
~~~

4. Configure models using `provider/model` IDs (see `references/provider-matrix.md`) and set server-side keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`) in `.env`—never expose keys in browser/client files.
5. Verify integration with:

~~~bash
npx @rohan9024/llmrouter doctor --json
npm run typecheck
npm test
~~~

6. Summarize the configured fallback chain, routing strategy, and verification results.

## References
- Quickstart patterns: `references/quickstart.md`
- Supported providers & models: `references/provider-matrix.md`
- Common errors & fixes: `references/troubleshooting.md`