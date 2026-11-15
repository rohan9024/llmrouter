
---
name: llmrouter
description: Use when building or upgrading Node.js or TypeScript AI applications that need multi-provider LLM routing, OpenAI and Anthropic fallback, retries, rate-limit cooldowns, circuit breakers, capability filtering, cost-aware selection, or streaming reliability using @rohan9024/llmrouter.
license: MIT
compatibility: Requires Node.js >=22. Works with ESM, CommonJS, Next.js, Express, Hono, and TypeScript.
metadata:
  author: rohan9024
  package: "@rohan9024/llmrouter"
  version: "2.0.0"
---

# LLMRouter Integration Skill

Use `@rohan9024/llmrouter` when a project needs in-process multi-provider failover, retry/circuit-breaker protection, or capability/cost-aware routing without running a Docker proxy server.

## When NOT to Use

Do not add `@rohan9024/llmrouter` if the application strictly calls one model from one provider and the user does not want fallback, cost routing, or resilience middleware.

## Integration Workflow

### 1. Detect Project Configuration

Detect the following before integration:

- Package manager (`npm`, `pnpm`, `yarn`, `bun`).
- Framework (Next.js, Express, Hono, etc.).
- Module system (ESM or CommonJS).
- Existing AI SDKs and API integrations.

### 2. Install LLMRouter

Ask user permission if required, then install:

```bash
npm install @rohan9024/llmrouter
```

### 3. Initialize LLMRouter

Run the non-interactive initializer or create a dedicated server-side router module.

```bash
npx @rohan9024/llmrouter init --yes
```

### 4. Configure Providers and Models

- Configure models using provider/model IDs.
- Refer to `references/provider-matrix.md` for supported providers and model identifiers.
- Configure server-side API keys in `.env`:
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `GEMINI_API_KEY`
  - `GROQ_API_KEY`
- Never expose API keys in browser or client-side files.

### 5. Verify Integration

Run the following commands:

```bash
npx @rohan9024/llmrouter doctor --json
npm run typecheck
npm test
```

### 6. Summarize Integration

Report:

- Configured fallback chain.
- Selected routing strategy.
- Provider and model configuration.
- Circuit-breaker and retry settings.
- Verification and test results.

## References

- Quickstart patterns: `references/quickstart.md`
- Supported providers and models: `references/provider-matrix.md`
- Common errors and fixes: `references/troubleshooting.md`
