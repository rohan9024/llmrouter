
# Supported Providers

## Built-in Provider Adapters

LLMRouter includes built-in adapters for the following providers:

- `openai`
- `anthropic`
- `gemini`
- `groq`
- `ollama`
- `openrouter`
- `together`
- `deepseek`
- `mistral`

It also supports custom OpenAI-compatible endpoints through `baseUrl` or `providers` configuration.

## Environment Variables

The following environment variables are resolved automatically:

| Provider | Environment Variable |
|---|---|
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Google Gemini | `GEMINI_API_KEY` |
| Groq | `GROQ_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| Together AI | `TOGETHER_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |
| Mistral | `MISTRAL_API_KEY` |
| Ollama | `OLLAMA_HOST` |
