import { ModelConfigInput, ModelDefinition } from '../types.js';

export const CATALOG_VERSION = '2026-11-15';

const DEFAULT_MODEL_LIST: ModelDefinition[] = [
  {
    id: 'openai/gpt-5-mini',
    provider: 'openai',
    model: 'gpt-5-mini',
    capabilities: { text: true, vision: true, tools: true, structuredOutput: true, audioInput: false, audioOutput: false, reasoning: true },
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    pricing: { inputPerMillionTokens: 0.25, outputPerMillionTokens: 2.0, cachedInputPerMillionTokens: 0.025, updatedAt: CATALOG_VERSION, source: 'builtin-catalog' },
    privacy: { zeroDataRetention: 'unknown' }
  },
  {
    id: 'openai/gpt-5.5-pro',
    provider: 'openai',
    model: 'gpt-5.5-pro',
    capabilities: { text: true, vision: true, tools: true, structuredOutput: true, audioInput: false, audioOutput: false, reasoning: true },
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    pricing: { inputPerMillionTokens: 5.0, outputPerMillionTokens: 30.0, cachedInputPerMillionTokens: 0.5, updatedAt: CATALOG_VERSION, source: 'builtin-catalog' },
    privacy: { zeroDataRetention: 'unknown' }
  },
  {
    id: 'openai/gpt-4.1',
    provider: 'openai',
    model: 'gpt-4.1',
    capabilities: { text: true, vision: true, tools: true, structuredOutput: true, audioInput: false, audioOutput: false, reasoning: false },
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    pricing: { inputPerMillionTokens: 2.0, outputPerMillionTokens: 8.0, cachedInputPerMillionTokens: 0.5, updatedAt: CATALOG_VERSION, source: 'builtin-catalog' },
    privacy: { zeroDataRetention: 'unknown' }
  },
  {
    id: 'openai/gpt-4o',
    provider: 'openai',
    model: 'gpt-4o',
    capabilities: { text: true, vision: true, tools: true, structuredOutput: true, audioInput: false, audioOutput: false, reasoning: false },
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    pricing: { inputPerMillionTokens: 2.5, outputPerMillionTokens: 10.0, cachedInputPerMillionTokens: 1.25, updatedAt: CATALOG_VERSION, source: 'builtin-catalog' },
    privacy: { zeroDataRetention: 'unknown' }
  },
  {
    id: 'openai/gpt-4o-mini',
    provider: 'openai',
    model: 'gpt-4o-mini',
    capabilities: { text: true, vision: true, tools: true, structuredOutput: true, audioInput: false, audioOutput: false, reasoning: false },
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    pricing: { inputPerMillionTokens: 0.15, outputPerMillionTokens: 0.6, cachedInputPerMillionTokens: 0.075, updatedAt: CATALOG_VERSION, source: 'builtin-catalog' },
    privacy: { zeroDataRetention: 'unknown' }
  },
  {
    id: 'anthropic/claude-sonnet-5-5',
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    capabilities: { text: true, vision: true, tools: true, structuredOutput: true, audioInput: false, audioOutput: false, reasoning: true },
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    pricing: { inputPerMillionTokens: 2.0, outputPerMillionTokens: 10.0, cachedInputPerMillionTokens: 0.2, updatedAt: CATALOG_VERSION, source: 'builtin-catalog' },
    privacy: { zeroDataRetention: 'unknown' }
  },
  {
    id: 'anthropic/claude-haiku-5-5',
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    capabilities: { text: true, vision: true, tools: true, structuredOutput: true, audioInput: false, audioOutput: false, reasoning: true },
    contextWindow: 1_000_000,
    maxOutputTokens: 32_000,
    pricing: { inputPerMillionTokens: 0.1, outputPerMillionTokens: 0.5, cachedInputPerMillionTokens: 0.01, updatedAt: CATALOG_VERSION, source: 'builtin-catalog' },
    privacy: { zeroDataRetention: 'unknown' }
  },
  {
    id: 'anthropic/claude-3-7-sonnet',
    provider: 'anthropic',
    model: 'claude-3-7-sonnet',
    capabilities: { text: true, vision: true, tools: true, structuredOutput: false, audioInput: false, audioOutput: false, reasoning: true },
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    pricing: { inputPerMillionTokens: 3.0, outputPerMillionTokens: 15.0, cachedInputPerMillionTokens: 0.3, updatedAt: CATALOG_VERSION, source: 'builtin-catalog' },
    privacy: { zeroDataRetention: 'unknown' }
  },
  {
    id: 'gemini/gemini-3.8-flash',
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    capabilities: { text: true, vision: true, tools: true, structuredOutput: true, audioInput: true, audioOutput: false, reasoning: true },
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    pricing: { inputPerMillionTokens: 0.75, outputPerMillionTokens: 3.75, cachedInputPerMillionTokens: 0.075, updatedAt: CATALOG_VERSION, source: 'builtin-catalog' },
    privacy: { zeroDataRetention: 'unknown' }
  },
  {
    id: 'gemini/gemini-2.5-flash',
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    capabilities: { text: true, vision: true, tools: true, structuredOutput: true, audioInput: true, audioOutput: false, reasoning: true },
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    pricing: { inputPerMillionTokens: 0.3, outputPerMillionTokens: 2.5, cachedInputPerMillionTokens: 0.075, updatedAt: CATALOG_VERSION, source: 'builtin-catalog' },
    privacy: { zeroDataRetention: 'unknown' }
  },
  {
    id: 'groq/openai/gpt-oss-120b',
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    capabilities: { text: true, vision: false, tools: true, structuredOutput: true, audioInput: false, audioOutput: false, reasoning: true },
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    pricing: { inputPerMillionTokens: 0.15, outputPerMillionTokens: 0.6, updatedAt: CATALOG_VERSION, source: 'builtin-catalog' },
    privacy: { zeroDataRetention: 'unknown' }
  },
  {
    id: 'groq/llama-3.3-70b-versatile',
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    capabilities: { text: true, vision: false, tools: true, structuredOutput: false, audioInput: false, audioOutput: false, reasoning: false },
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
    pricing: { inputPerMillionTokens: 0.59, outputPerMillionTokens: 0.79, updatedAt: CATALOG_VERSION, source: 'builtin-catalog' },
    privacy: { zeroDataRetention: 'unknown' }
  },
  {
    id: 'ollama/llama3.3',
    provider: 'ollama',
    model: 'llama3.3',
    capabilities: { text: true, vision: false, tools: true, structuredOutput: true, audioInput: false, audioOutput: false, reasoning: false },
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    pricing: { inputPerMillionTokens: 0, outputPerMillionTokens: 0, updatedAt: CATALOG_VERSION, source: 'local-inference' },
    privacy: { zeroDataRetention: true, dataResidency: ['local'], source: 'local-inference' }
  },
  {
    id: 'ollama/llama3',
    provider: 'ollama',
    model: 'llama3',
    capabilities: { text: true, vision: false, tools: false, structuredOutput: false, audioInput: false, audioOutput: false, reasoning: false },
    contextWindow: 8_192,
    maxOutputTokens: 4_096,
    pricing: { inputPerMillionTokens: 0, outputPerMillionTokens: 0, updatedAt: CATALOG_VERSION, source: 'local-inference' },
    privacy: { zeroDataRetention: true, dataResidency: ['local'], source: 'local-inference' }
  }
];

export const BUILTIN_MODELS: ReadonlyArray<ModelDefinition> = DEFAULT_MODEL_LIST;

export function parseTargetId(target: string): { provider: string; model: string; id: string } {
  const slashIdx = target.indexOf('/');
  if (slashIdx === -1) return { provider: 'openai', model: target, id: `openai/${target}` };
  const provider = target.slice(0, slashIdx).toLowerCase();
  const model = target.slice(slashIdx + 1);
  return { provider, model, id: `${provider}/${model}` };
}

export class ModelRegistry {
  private readonly entries = new Map<string, ModelDefinition>();

  constructor(overrides?: ModelDefinition[]) {
    for (const def of DEFAULT_MODEL_LIST) this.entries.set(def.id, structuredClone(def));
    if (overrides) for (const custom of overrides) this.register(custom);
  }

  register(def: ModelDefinition): void {
    const existing = this.entries.get(def.id);
    if (!existing) {
      this.entries.set(def.id, structuredClone(def));
      return;
    }
    this.entries.set(def.id, {
      ...existing,
      ...def,
      capabilities: { ...existing.capabilities, ...def.capabilities },
      privacy: { ...existing.privacy, ...def.privacy }
    });
  }

  list(): ModelDefinition[] {
    return Array.from(this.entries.values());
  }

  resolve(input: ModelConfigInput): ModelDefinition {
    const id = typeof input === 'string' ? input : input.id;
    const parsed = parseTargetId(id);
    const known = this.entries.get(id) ?? this.entries.get(parsed.id);
    const base: ModelDefinition = known
      ? structuredClone(known)
      : {
          id,
          provider: parsed.provider,
          model: parsed.model,
          capabilities: { text: true, vision: false, tools: true, structuredOutput: false, audioInput: false, audioOutput: false, reasoning: false },
          privacy: { zeroDataRetention: 'unknown' }
        };

    if (typeof input === 'string') return { ...base, id };
    return {
      ...base,
      id: input.id,
      provider: parsed.provider,
      model: parsed.model,
      capabilities: { ...base.capabilities, ...input.capabilities },
      contextWindow: input.contextWindow ?? base.contextWindow,
      maxOutputTokens: input.maxOutputTokens ?? base.maxOutputTokens,
      pricing: input.pricing ?? base.pricing,
      privacy: input.privacy ?? base.privacy,
      weight: input.weight ?? base.weight,
      baseUrl: input.baseUrl ?? base.baseUrl,
      headers: input.headers ?? base.headers,
      apiKeyEnv: input.apiKeyEnv ?? base.apiKeyEnv,
      maxConcurrency: input.maxConcurrency ?? base.maxConcurrency
    };
  }
}
