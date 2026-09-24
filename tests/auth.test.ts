import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  loadCachedToken,
  loadCachedTokens,
  saveCachedToken,
  saveCachedTokens,
  addToken,
  removeToken,
  clearCachedToken,
  rotateToNextToken,
  getAuthFilePath,
  resolveAuthToken,
  isHeadlessEnvironment,
} from '../src/auth.js';

describe('Auth Module', () => {
  const testDir = path.join(os.tmpdir(), `mycli-auth-test-${Date.now()}`);
  const testAuthFile = path.join(testDir, 'auth.json');
  const originalEnvToken = process.env.PUTER_AUTH_TOKEN;
  const originalAuthPath = process.env.MYCLI_AUTH_PATH;

  beforeEach(() => {
    delete process.env.PUTER_AUTH_TOKEN;
    delete process.env.MYCLI_AUTH_PATH;
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (originalEnvToken !== undefined) {
      process.env.PUTER_AUTH_TOKEN = originalEnvToken;
    } else {
      delete process.env.PUTER_AUTH_TOKEN;
    }

    if (originalAuthPath !== undefined) {
      process.env.MYCLI_AUTH_PATH = originalAuthPath;
    } else {
      delete process.env.MYCLI_AUTH_PATH;
    }

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('loadCachedToken returns null when file does not exist', () => {
    const token = loadCachedToken(testAuthFile);
    assert.strictEqual(token, null);
  });

  test('saveCachedToken persists token with restricted permissions and loadCachedToken retrieves it', () => {
    const sampleToken = 'puter_token_abcdef123456';
    saveCachedToken(sampleToken, testAuthFile);

    assert.strictEqual(fs.existsSync(testAuthFile), true);

    const loaded = loadCachedToken(testAuthFile);
    assert.strictEqual(loaded, sampleToken);

    if (process.platform !== 'win32') {
      const stats = fs.statSync(testAuthFile);
      const mode = stats.mode & 0o777;
      assert.strictEqual(mode, 0o600);
    }
  });

  test('addToken adds unique tokens and removeToken removes them', () => {
    addToken('token_1', testAuthFile);
    addToken('token_2', testAuthFile);
    // Duplicate token should not increase count
    const res = addToken('token_1', testAuthFile);
    assert.strictEqual(res.count, 2);

    const loaded = loadCachedTokens(testAuthFile);
    assert.deepStrictEqual(loaded.tokens, ['token_1', 'token_2']);

    // Remove token by position (1-based index)
    const removedFirst = removeToken('1', testAuthFile);
    assert.strictEqual(removedFirst, true);

    const remaining = loadCachedTokens(testAuthFile);
    assert.deepStrictEqual(remaining.tokens, ['token_2']);

    // Remove token by value
    const removedSecond = removeToken('token_2', testAuthFile);
    assert.strictEqual(removedSecond, true);

    const empty = loadCachedTokens(testAuthFile);
    assert.deepStrictEqual(empty.tokens, []);
  });

  test('resolveAuthToken performs round-robin rotation across multiple cached tokens', async () => {
    addToken('token_alpha', testAuthFile);
    addToken('token_beta', testAuthFile);
    addToken('token_gamma', testAuthFile);

    const run1 = await resolveAuthToken({ customAuthPath: testAuthFile });
    const run2 = await resolveAuthToken({ customAuthPath: testAuthFile });
    const run3 = await resolveAuthToken({ customAuthPath: testAuthFile });
    const run4 = await resolveAuthToken({ customAuthPath: testAuthFile });

    assert.strictEqual(run1.token, 'token_alpha');
    assert.strictEqual(run2.token, 'token_beta');
    assert.strictEqual(run3.token, 'token_gamma');
    assert.strictEqual(run4.token, 'token_alpha'); // Rotates back to first token
  });

  test('resolveAuthToken rotates comma-separated PUTER_AUTH_TOKEN environment variable', async () => {
    process.env.PUTER_AUTH_TOKEN = 'env_tok_1, env_tok_2, env_tok_3';

    const r1 = await resolveAuthToken();
    const r2 = await resolveAuthToken();
    const r3 = await resolveAuthToken();
    const r4 = await resolveAuthToken();

    assert.strictEqual(r1.token, 'env_tok_1');
    assert.strictEqual(r2.token, 'env_tok_2');
    assert.strictEqual(r3.token, 'env_tok_3');
    assert.strictEqual(r4.token, 'env_tok_1');
  });

  test('saveCachedToken throws on empty token', () => {
    assert.throws(() => saveCachedToken('', testAuthFile), /Cannot persist empty authentication token/);
    assert.throws(() => saveCachedToken('   ', testAuthFile), /Cannot persist empty authentication token/);
  });

  test('clearCachedToken removes the file', () => {
    saveCachedToken('sample_token', testAuthFile);
    assert.strictEqual(fs.existsSync(testAuthFile), true);

    const cleared = clearCachedToken(testAuthFile);
    assert.strictEqual(cleared, true);
    assert.strictEqual(fs.existsSync(testAuthFile), false);

    const clearedAgain = clearCachedToken(testAuthFile);
    assert.strictEqual(clearedAgain, false);
  });

  test('resolveAuthToken prioritizes PUTER_AUTH_TOKEN environment variable over cache', async () => {
    process.env.PUTER_AUTH_TOKEN = 'env_override_token_999';
    saveCachedToken('cached_token_111', testAuthFile);

    const result = await resolveAuthToken({ customAuthPath: testAuthFile });
    assert.strictEqual(result.token, 'env_override_token_999');
    assert.strictEqual(result.source, 'env');
  });

  test('resolveAuthToken uses cached token when PUTER_AUTH_TOKEN is not set', async () => {
    delete process.env.PUTER_AUTH_TOKEN;
    saveCachedToken('cached_token_222', testAuthFile);

    const result = await resolveAuthToken({ customAuthPath: testAuthFile });
    assert.strictEqual(result.token, 'cached_token_222');
    assert.strictEqual(result.source, 'cache');
  });

  test('customAuthPath and MYCLI_AUTH_PATH are respected by getAuthFilePath', () => {
    const custom = '/tmp/custom/path/auth.json';
    assert.strictEqual(getAuthFilePath(custom), path.resolve(custom));

    process.env.MYCLI_AUTH_PATH = '/tmp/env_path/auth.json';
    assert.strictEqual(getAuthFilePath(), path.resolve('/tmp/env_path/auth.json'));
  });

  test('headless environment detection identifies CI environments', () => {
    const originalCI = process.env.CI;
    try {
      process.env.CI = 'true';
      assert.strictEqual(isHeadlessEnvironment(), true);
    } finally {
      if (originalCI !== undefined) {
        process.env.CI = originalCI;
      } else {
        delete process.env.CI;
      }
    }
  });
});
