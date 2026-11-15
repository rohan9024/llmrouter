import {
  ChatCompletionCreateParams,
  ChatMessage,
  ContentPart,
  ModelCapabilities,
  ModelDefinition,
  RequestExecutionOptions
} from '../types.js';

export interface NormalizedRequest {
  params: ChatCompletionCreateParams;
  estimatedInputTokens: number;
  expectedOutputTokens: number;
  requiredCapabilities: Partial<ModelCapabilities>;
}

function contentLengthEstimate(content: string | ContentPart[] | null | undefined): { chars: number; images: number } {
  if (!content) return { chars: 0, images: 0 };
  if (typeof content === 'string') return { chars: content.length, images: 0 };
  let chars = 0;
  let images = 0;
  for (const part of content) {
    if (part.type === 'text') chars += part.text.length;
    else if (part.type === 'image_url') images += 1;
  }
  return { chars, images };
}

export function hasVisionInput(messages: ChatMessage[]): boolean {
  return messages.some(msg => Array.isArray(msg.content) && msg.content.some(part => part.type === 'image_url'));
}

export function estimateRequestTokens(params: ChatCompletionCreateParams): number {
  let chars = 0;
  let images = 0;
  for (const msg of params.messages) {
    chars += 16;
    const est = contentLengthEstimate(msg.content);
    chars += est.chars;
    images += est.images;
    if (msg.tool_calls) chars += JSON.stringify(msg.tool_calls).length;
  }
  if (params.tools && params.tools.length > 0) chars += JSON.stringify(params.tools).length;
  if (params.response_format?.type === 'json_schema') chars += JSON.stringify(params.response_format.json_schema).length;
  return Math.max(1, Math.ceil(chars / 3.5) + images * 765);
}

export function inferRequiredCapabilities(
  params: ChatCompletionCreateParams,
  explicit?: Partial<ModelCapabilities>
): Partial<ModelCapabilities> {
  const required: Partial<ModelCapabilities> = { text: true, ...explicit };
  if (hasVisionInput(params.messages)) required.vision = true;
  if (params.tools && params.tools.length > 0) required.tools = true;
  if (params.response_format?.type === 'json_schema') required.structuredOutput = true;
  return required;
}

export function estimateModelCostUsd(
  model: ModelDefinition,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens: number = 0
): number | undefined {
  if (!model.pricing) return undefined;
  const nonCached = Math.max(0, inputTokens - cachedInputTokens);
  const inputCost = (nonCached / 1_000_000) * model.pricing.inputPerMillionTokens;
  const cachedRate = model.pricing.cachedInputPerMillionTokens ?? model.pricing.inputPerMillionTokens;
  const cachedCost = (cachedInputTokens / 1_000_000) * cachedRate;
  const outputCost = (outputTokens / 1_000_000) * model.pricing.outputPerMillionTokens;
  return Number((inputCost + cachedCost + outputCost).toFixed(8));
}

export function normalizeRequest(params: ChatCompletionCreateParams, options?: RequestExecutionOptions): NormalizedRequest {
  return {
    params,
    estimatedInputTokens: estimateRequestTokens(params),
    expectedOutputTokens: params.max_tokens ?? 1024,
    requiredCapabilities: inferRequiredCapabilities(params, options?.capabilities)
  };
}
