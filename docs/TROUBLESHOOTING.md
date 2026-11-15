
# Troubleshooting

## AllProvidersFailedError

When all configured providers fail, LLMRouter throws `AllProvidersFailedError`.

Inspect the following properties:

- `err.errors`: Individual provider errors.
- `err.attempts`: Details of attempted model requests.

Errors may include typed `RouterErrorCode` values, such as:

- `AUTHENTICATION`
- `RATE_LIMITED`
- `CONTEXT_LENGTH`
- `TIMEOUT`

## Diagnostic Commands

Run the built-in diagnostic command to verify your environment:

```bash
npx @rohan9024/llmrouter doctor --json
```

The diagnostic checks:

- Node.js version.
- Installed package.
- Detected server-side environment keys.

## API Key Configuration

Ensure the required provider API keys are configured in your server-side `.env` file.

Never expose API keys in browser or client-side code.
