export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ChatCompletionCreateParams {
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  model?: string;
  [key: string]: unknown;
}

export interface ChatCompletionChoice {
  index: number;
  message: { role: 'assistant'; content: string };
  finish_reason: string;
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface RouterMeta {
  providerUsed: string;
  modelUsed: string;
  attempts: number;
  latencyMs: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: ChatCompletionUsage;
  _routerMeta: RouterMeta;
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: { role?: 'assistant'; content?: string };
  finish_reason?: string | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
}

export interface ParsedTarget {
  provider: string;
  model: string;
  raw: string;
}

export interface RouterConfig {
  models: string[];
  apiKeys?: Record<string, string>;
  timeoutMs?: number;
}