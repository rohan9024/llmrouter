
# API Reference — @rohan9024/llmrouter

## Router

### Constructor

`new Router(config | string[])`

Configures the router with supported models and routing options.

**Configuration options:**

- `models`: List of provider/model identifiers.
- `strategy`: Routing strategy:
  - `priority`
  - `weighted`
  - `lowest-cost`
  - `lowest-latency`
  - `health-aware`
  - `balanced`
- `retry`: Retry configuration.
- `circuitBreaker`: Circuit-breaker configuration.
- `timeout`: Request timeout configuration.
- `concurrency`: Concurrency limits.
- `adaptive`: Adaptive routing configuration.
- `privacy`: Privacy and data-handling constraints.
- `budget`: Cost budget configuration.

## Chat Completions

### `router.chat.completions.create(params, options?)`

Provides OpenAI-style chat completions with support for:

- Tool calling (`tools`).
- Structured outputs (`response_format`).
- Vision inputs (`image_url`).
- Streaming (`stream: true`).

## Routing Explanation

### `router.explain(params, options?)`

Provides a dry-run routing planner returning:

```typescript
{
  selected,
  reason,
  candidates,
  rejected
}
```

## Operational Statistics

### `router.stats()`

Returns:

- Live latency percentiles.
- Cost totals.
- Per-model health states.

## Event Listeners

### `router.on(event, listener)`

Subscribe to routing and reliability events.

**Supported events:**

- `attempt`
- `retry`
- `fallback`
- `circuit-open`
- `circuit-close`
- `cooldown`
- `success`
- `failure`
