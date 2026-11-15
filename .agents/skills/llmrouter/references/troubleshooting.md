# Troubleshooting

- **Missing backup provider**: Run `npx @rohan9024/llmrouter doctor --json` and configure at least 2 provider env vars.
- **Model rejected before dispatch**: Call `router.explain(request)` to see capability, ZDR privacy, context window, or budget rejections.
- **401 skipping backup?** Ensure you are on `@rohan9024/llmrouter >= 2.0.0`, where `AUTHENTICATION` skips that provider cleanly and falls back to the next target.