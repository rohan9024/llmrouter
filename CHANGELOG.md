
# Changelog

## [2.0.0]

### Added

- Added a separated Retry, Cooldown, Circuit Breaker, Concurrency, and Deadline reliability engine.
- Added a capability-aware model registry.
- Added privacy/ZDR constraints and budget controls.
- Added six routing strategies.
- Added explainable routing through `explain()` and operational metrics through `stats()`.
- Added full tool-calling, multimodal vision, JSON Schema, and SSE stream normalization across OpenAI-compatible, Anthropic, and Gemini providers.
- Added an agent-first CLI with:
  - `init`
  - `doctor`
  - `providers`
  - `models`
  - `explain`
  - `benchmark`
  - `migrate`
- Added `.agents/skills` integration for skills.sh.
