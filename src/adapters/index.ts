import { ProviderAdapter } from './base.js';
import { OpenAICompatAdapter } from './openai-compat.js';
import { AnthropicAdapter } from './anthropic.js';
import { GeminiAdapter } from './gemini.js';
import { ProviderEndpointConfig } from '../types.js';

export type { ProviderAdapter, ProviderAdapterCapabilities, AdapterExecutionOptions } from './base.js';
export { OpenAICompatAdapter } from './openai-compat.js';
export { AnthropicAdapter } from './anthropic.js';
export { GeminiAdapter } from './gemini.js';

export class AdapterRegistry {
  private readonly customAdapters = new Map<string, ProviderAdapter>();
  private readonly openAICompat = new OpenAICompatAdapter();
  private readonly anthropic = new AnthropicAdapter();
  private readonly gemini = new GeminiAdapter();

  register(provider: string, adapter: ProviderAdapter): void {
    this.customAdapters.set(provider.toLowerCase(), adapter);
  }

  resolve(provider: string, endpointCfg?: ProviderEndpointConfig): ProviderAdapter {
    const key = provider.toLowerCase();
    const custom = this.customAdapters.get(key);
    if (custom) return custom;
    if (endpointCfg?.type === 'anthropic' || key === 'anthropic') return this.anthropic;
    if (endpointCfg?.type === 'gemini' || key === 'gemini') return this.gemini;
    return this.openAICompat;
  }

  listBuiltins(): Array<{ id: string; providers: string[]; capabilities: ProviderAdapter['capabilities'] }> {
    return [
      { id: this.openAICompat.id, providers: ['openai', 'groq', 'ollama', 'openrouter', 'together', 'deepseek', 'mistral', 'custom'], capabilities: this.openAICompat.capabilities },
      { id: this.anthropic.id, providers: ['anthropic'], capabilities: this.anthropic.capabilities },
      { id: this.gemini.id, providers: ['gemini'], capabilities: this.gemini.capabilities }
    ];
  }
}
