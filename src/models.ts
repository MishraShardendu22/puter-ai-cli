import type { Puter } from '@heyputer/puter.js';

export interface ModelInfo {
  id: string;
  name: string;
  provider?: string;
  context?: number;
  maxTokens?: number;
  aliases?: string[];
  description?: string;
}

/**
 * Common aliases for legacy or abbreviated model names mapped to valid active Puter models.
 */
export const MODEL_ALIASES: Record<string, string> = {
  // Claude legacy/alias mappings -> Active Puter Claude models
  'claude-3-5-sonnet': 'claude-sonnet-4.5',
  'claude-3.5-sonnet': 'claude-sonnet-4.5',
  'claude-3.5': 'claude-sonnet-4.5',
  'claude-3-sonnet': 'claude-sonnet-4.5',
  'claude-sonnet': 'claude-sonnet-4.5',
  'claude': 'claude-sonnet-4.5',
  'anthropic/claude-3-5-sonnet': 'claude-sonnet-4.5',
  'anthropic/claude-3.5-sonnet': 'claude-sonnet-4.5',
  'claude-3-5-haiku': 'claude-haiku-4.5',
  'claude-3.5-haiku': 'claude-haiku-4.5',
  'claude-3-haiku': 'claude-haiku-4.5',
  'claude-haiku': 'claude-haiku-4.5',
  'anthropic/claude-3-5-haiku': 'claude-haiku-4.5',
  'claude-3-opus': 'claude-opus-4.5',
  'claude-3.5-opus': 'claude-opus-4.5',
  'claude-opus': 'claude-opus-4.5',
  'anthropic/claude-3-opus': 'claude-opus-4.5',

  // OpenAI legacy/alias mappings
  'gpt-4': 'gpt-4o',
  'gpt4': 'gpt-4o',
  'openai/gpt-4': 'gpt-4o',
  'openai/gpt-4o': 'gpt-4o',
  'gpt-3.5': 'gpt-5-nano',
  'gpt-3.5-turbo': 'gpt-5-nano',
  'gpt-5': 'gpt-5-nano',
  'gpt5': 'gpt-5-nano',

  // DeepSeek / Open weights
  'deepseek': 'deepseek-chat',
  'deepseek-v3': 'deepseek-chat',
  'deepseek-reasoner': 'deepseek-r1',
};

/**
 * Curated list of popular recommended models when offline or displaying quick help.
 */
export const POPULAR_MODELS: ModelInfo[] = [
  {
    id: 'gpt-5-nano',
    name: 'GPT-5 Nano',
    provider: 'OpenAI',
    description: 'Ultra-fast, lowest latency (<1s). Default model.',
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenAI',
    description: 'High intelligence multimodal with live web search support (-w).',
  },
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    provider: 'OpenAI',
    description: 'Frontier reasoning and complex architectural planning.',
  },
  {
    id: 'claude-haiku-4.5',
    name: 'Claude Haiku 4.5',
    provider: 'Anthropic',
    description: 'High-speed, cost-effective coding and refactoring.',
  },
  {
    id: 'claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    provider: 'Anthropic',
    description: 'State-of-the-art coding and complex technical reasoning.',
  },
  {
    id: 'claude-opus-4.5',
    name: 'Claude Opus 4.5',
    provider: 'Anthropic',
    description: 'Deepest frontier reasoning and long-horizon tasks.',
  },
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat (V3)',
    provider: 'DeepSeek',
    description: 'Strong general reasoning and multilingual capabilities.',
  },
  {
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    provider: 'DeepSeek',
    description: 'Open-weights reasoning model with chain-of-thought.',
  },
];

/**
 * Normalizes a user-specified model identifier.
 * Automatically resolves common aliases, handles case-insensitivity, and strips extra prefixes.
 */
export function normalizeModel(model: string | undefined): string | undefined {
  if (!model || typeof model !== 'string') {
    return undefined;
  }

  const trimmed = model.trim();
  const lower = trimmed.toLowerCase();

  // Direct alias check
  if (MODEL_ALIASES[lower]) {
    return MODEL_ALIASES[lower];
  }

  // Check without 'openrouter/' or 'openrouter:' prefix
  const stripped = lower.replace(/^openrouter[:/]/, '');
  if (MODEL_ALIASES[stripped]) {
    return MODEL_ALIASES[stripped];
  }

  return trimmed;
}

/**
 * Queries Puter AI for the complete list of available models.
 */
export async function fetchPuterModels(puter: Puter): Promise<ModelInfo[]> {
  try {
    if (typeof puter.ai.listModels === 'function') {
      const rawModels = await puter.ai.listModels();
      if (Array.isArray(rawModels) && rawModels.length > 0) {
        return rawModels.map((m: any) => ({
          id: m.id || m.puterId || 'unknown',
          name: m.name || m.id || 'Unknown Model',
          provider: m.provider || (m.id?.includes('claude') ? 'anthropic' : undefined),
          context: m.context,
          maxTokens: m.max_tokens,
          aliases: m.aliases,
        }));
      }
    }
  } catch {
    // Fall back to POPULAR_MODELS on failure
  }

  return POPULAR_MODELS;
}
