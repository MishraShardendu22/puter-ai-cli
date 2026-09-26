import { init } from '@heyputer/puter.js/src/init.cjs';
import type { Puter } from '@heyputer/puter.js';
import { normalizeModel, fetchPuterModels, type ModelInfo } from '../models.js';

export interface PuterProviderOptions {
  authToken: string;
}

export interface PuterChatOptions {
  model?: string;
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  webSearch?: boolean;
}

export class PuterError extends Error {
  public readonly statusCode?: number;
  public readonly originalError?: unknown;

  constructor(message: string, statusCode?: number, originalError?: unknown) {
    super(message);
    this.name = 'PuterError';
    this.statusCode = statusCode;
    this.originalError = originalError;
  }
}

/**
 * Extracts human-readable text from non-streaming Puter chat response shapes.
 */
export function extractTextFromResponse(response: unknown): string {
  if (typeof response === 'string') {
    return response;
  }

  if (!response || typeof response !== 'object') {
    return String(response ?? '');
  }

  const res = response as Record<string, any>;

  // Standard ChatResponse shape: response.message.content
  if (res.message) {
    const message = res.message;
    if (typeof message === 'string') {
      return message;
    }
    if (message.content !== undefined) {
      if (typeof message.content === 'string') {
        return message.content;
      }
      if (Array.isArray(message.content)) {
        return message.content
          .map((part: any) => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object') {
              if (typeof part.text === 'string') return part.text;
              if (typeof part.content === 'string') return part.content;
            }
            return '';
          })
          .join('');
      }
      if (typeof message.content === 'object' && message.content !== null) {
        if (typeof message.content.text === 'string') {
          return message.content.text;
        }
      }
      return String(message.content);
    }
  }

  // Fallback for response.text
  if (typeof res.text === 'string') {
    return res.text;
  }

  // Fallback for response.choices[0].message.content
  if (Array.isArray(res.choices) && res.choices.length > 0) {
    const choice = res.choices[0];
    if (choice?.message?.content) {
      return typeof choice.message.content === 'string'
        ? choice.message.content
        : JSON.stringify(choice.message.content);
    }
    if (typeof choice?.text === 'string') {
      return choice.text;
    }
  }

  return JSON.stringify(response);
}

/**
 * Extracts text chunk from an individual stream chunk.
 */
export function extractTextFromChunk(chunk: unknown): string {
  if (typeof chunk === 'string') {
    return chunk;
  }

  if (!chunk || typeof chunk !== 'object') {
    return '';
  }

  const c = chunk as Record<string, any>;

  if (c.type === 'error') {
    throw new PuterError(c.message || 'Stream error from Puter AI');
  }

  if (typeof c.text === 'string') {
    return c.text;
  }

  if (c.message) {
    if (typeof c.message === 'string') return c.message;
    if (typeof c.message?.content === 'string') return c.message.content;
  }

  if (c.delta) {
    if (typeof c.delta === 'string') return c.delta;
    if (typeof c.delta?.content === 'string') return c.delta.content;
    if (typeof c.delta?.text === 'string') return c.delta.text;
  }

  return '';
}

/**
 * Normalizes error messages from Puter SDK into user-friendly PuterError instances.
 */
function handlePuterApiError(error: unknown): never {
  if (error instanceof PuterError) {
    throw error;
  }

  const err = error as Record<string, any>;
  const status = typeof err?.status === 'number' ? err.status : undefined;
  const message = err?.message || (typeof error === 'string' ? error : 'Unknown error from Puter AI API');

  if (status === 401 || message === 'Unauthorized' || message.includes('Unauthorized')) {
    throw new PuterError(
      'Authentication failed with Puter (401 Unauthorized).\n' +
      'Your token may be invalid, revoked, or expired.\n' +
      'To re-authenticate, run:\n' +
      '  mycli auth logout\n' +
      'Or provide a valid token via the PUTER_AUTH_TOKEN environment variable.',
      401,
      error
    );
  }

  if (status === 429 || message.includes('rate limit') || message.includes('Too Many Requests')) {
    throw new PuterError('Puter rate limit exceeded. Please wait a moment and try again.', 429, error);
  }

  if (status === 403) {
    throw new PuterError('Access forbidden by Puter. Please verify your account permissions.', 403, error);
  }

  if (message.includes('fetch failed') || message.includes('ENOTFOUND') || message.includes('ECONNREFUSED')) {
    throw new PuterError('Failed to connect to Puter API. Please check your network connection.', undefined, error);
  }

  if (message.includes('Model not found')) {
    throw new PuterError(
      `${message}\n` +
      `Tip: Run 'mycli models' to see active models on Puter AI.\n` +
      `Popular alternatives: claude-sonnet-4.5, claude-haiku-4.5, gpt-4o, gpt-5-nano, deepseek-chat.`,
      404,
      error
    );
  }

  throw new PuterError(`Puter AI Error: ${message}`, status, error);
}

export class PuterProvider {
  private puter: Puter;

  constructor(options: PuterProviderOptions) {
    if (!options.authToken || options.authToken.trim() === '') {
      throw new PuterError('PuterProvider requires a valid authToken.');
    }
    this.puter = init(options.authToken.trim());
  }

  /**
   * Request chat completion from Puter AI.
   * If streaming is enabled (default) and supported, yields text chunks as an AsyncGenerator.
   * If streaming is not supported or disabled, yields the full completion response.
   */
  async *chatStream(
    prompt: string,
    options: PuterChatOptions = {}
  ): AsyncGenerator<string, void, unknown> {
    const shouldStream = options.stream ?? true;
    const requestOptions: Record<string, any> = {
      stream: shouldStream,
    };

    const resolvedModel = normalizeModel(options.model);
    if (resolvedModel) {
      requestOptions.model = resolvedModel;
    }
    if (typeof options.temperature === 'number') {
      requestOptions.temperature = options.temperature;
    }
    if (typeof options.maxTokens === 'number') {
      requestOptions.max_tokens = options.maxTokens;
    }
    if (options.webSearch) {
      requestOptions.tools = [{ type: 'web_search' }];
    }

    let response: unknown;
    try {
      response = await this.puter.ai.chat(prompt, requestOptions);
    } catch (error) {
      handlePuterApiError(error);
    }

    // Check if the response is an async iterable (streaming supported)
    if (response && typeof (response as any)[Symbol.asyncIterator] === 'function') {
      try {
        for await (const chunk of response as AsyncIterable<unknown>) {
          const text = extractTextFromChunk(chunk);
          if (text) {
            yield text;
          }
        }
      } catch (streamError) {
        handlePuterApiError(streamError);
      }
    } else {
      // Non-streaming response fallback
      const fullText = extractTextFromResponse(response);
      if (fullText) {
        yield fullText;
      }
    }
  }

  /**
   * Complete non-streaming chat or aggregate streaming chunks into a single string.
   */
  async chat(prompt: string, options: PuterChatOptions = {}): Promise<string> {
    let result = '';
    for await (const chunk of this.chatStream(prompt, options)) {
      result += chunk;
    }
    return result;
  }

  /**
   * List available models from Puter AI.
   */
  async listModels(): Promise<ModelInfo[]> {
    return fetchPuterModels(this.puter);
  }
}
