import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  PuterProvider,
  PuterError,
  extractTextFromResponse,
  extractTextFromChunk,
} from '../src/providers/puter.js';

describe('Puter Provider Module', () => {
  test('PuterProvider constructor throws on empty auth token', () => {
    assert.throws(() => new PuterProvider({ authToken: '' }), /requires a valid authToken/);
    assert.throws(() => new PuterProvider({ authToken: '   ' }), /requires a valid authToken/);
  });

  test('extractTextFromResponse handles standard message string content', () => {
    const response = {
      message: {
        role: 'assistant',
        content: 'This is the AI response.',
      },
    };
    const extracted = extractTextFromResponse(response);
    assert.strictEqual(extracted, 'This is the AI response.');
  });

  test('extractTextFromResponse handles array of content parts', () => {
    const response = {
      message: {
        role: 'assistant',
        content: [
          { text: 'Hello ' },
          { text: 'World!' },
        ],
      },
    };
    const extracted = extractTextFromResponse(response);
    assert.strictEqual(extracted, 'Hello World!');
  });

  test('extractTextFromResponse handles string responses', () => {
    assert.strictEqual(extractTextFromResponse('Plain text output'), 'Plain text output');
  });

  test('extractTextFromResponse handles choices array fallback', () => {
    const response = {
      choices: [
        {
          message: {
            content: 'Choice content',
          },
        },
      ],
    };
    assert.strictEqual(extractTextFromResponse(response), 'Choice content');
  });

  test('extractTextFromChunk extracts delta and text from stream chunks', () => {
    assert.strictEqual(extractTextFromChunk('raw chunk'), 'raw chunk');
    assert.strictEqual(extractTextFromChunk({ type: 'text', text: 'token chunk' }), 'token chunk');
    assert.strictEqual(extractTextFromChunk({ text: 'just text' }), 'just text');
    assert.strictEqual(extractTextFromChunk({ message: 'chunk message' }), 'chunk message');
    assert.strictEqual(extractTextFromChunk({ delta: { content: 'chunk delta' } }), 'chunk delta');
  });

  test('extractTextFromChunk throws PuterError when chunk type is error', () => {
    assert.throws(
      () => extractTextFromChunk({ type: 'error', message: 'Stream failed' }),
      /Stream failed/
    );
  });

  test('PuterError captures statusCode and original error', () => {
    const orig = new Error('root cause');
    const err = new PuterError('Auth failed', 401, orig);
    assert.strictEqual(err.name, 'PuterError');
    assert.strictEqual(err.message, 'Auth failed');
    assert.strictEqual(err.statusCode, 401);
    assert.strictEqual(err.originalError, orig);
  });

  test('chatStream streams chunks from async iterable response', async () => {
    const provider = new PuterProvider({ authToken: 'dummy_token' });

    // Mock internal puter.ai.chat to return an async iterable
    async function* mockStream() {
      yield { type: 'text', text: 'Epoll ' };
      yield { type: 'text', text: 'is ' };
      yield { type: 'text', text: 'an ' };
      yield { type: 'text', text: 'I/O event notification facility.' };
    }

    (provider as any).puter = {
      ai: {
        chat: async () => mockStream(),
      },
    };

    const chunks: string[] = [];
    for await (const chunk of provider.chatStream('Explain epoll.')) {
      chunks.push(chunk);
    }

    assert.deepStrictEqual(chunks, [
      'Epoll ',
      'is ',
      'an ',
      'I/O event notification facility.',
    ]);
  });

  test('chatStream falls back gracefully to non-streaming response', async () => {
    const provider = new PuterProvider({ authToken: 'dummy_token' });

    (provider as any).puter = {
      ai: {
        chat: async () => ({
          message: {
            content: 'Epoll is scalable I/O multiplexing.',
          },
        }),
      },
    };

    const chunks: string[] = [];
    for await (const chunk of provider.chatStream('Explain epoll.', { stream: false })) {
      chunks.push(chunk);
    }

    assert.deepStrictEqual(chunks, ['Epoll is scalable I/O multiplexing.']);

    const fullResponse = await provider.chat('Explain epoll.', { stream: false });
    assert.strictEqual(fullResponse, 'Epoll is scalable I/O multiplexing.');
  });
});
