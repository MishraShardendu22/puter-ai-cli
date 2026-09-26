import { test, describe } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliEntry = path.resolve(__dirname, '../dist/index.js');

function runCli(
  args: string[],
  env: Record<string, string | undefined> = {},
  input?: string
): Promise<{
  stdout: string;
  stderr: string;
  code: number;
}> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [cliEntry, ...args],
      {
        env: {
          ...process.env,
          ...env,
        },
      },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === 'number' ? error.code : (error ? 1 : 0);
        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          code,
        });
      }
    );

    if (input !== undefined) {
      child.stdin?.write(input);
    }
    child.stdin?.end();
  });
}

describe('CLI Integration Tests', () => {
  const tempAuthDir = path.join(os.tmpdir(), `mycli-cli-test-${Date.now()}`);
  const tempAuthFile = path.join(tempAuthDir, 'auth.json');

  test('mycli --version prints 1.0.0', async () => {
    const res = await runCli(['--version']);
    assert.strictEqual(res.code, 0);
    assert.ok(res.stdout.includes('1.0.0'));
  });

  test('mycli --help displays available commands', async () => {
    const res = await runCli(['--help']);
    assert.strictEqual(res.code, 0);
    assert.ok(res.stdout.includes('Usage: mycli'));
    assert.ok(res.stdout.includes('ask'));
    assert.ok(res.stdout.includes('auth'));
  });

  test('mycli ask --help displays ask options', async () => {
    const res = await runCli(['ask', '--help']);
    assert.strictEqual(res.code, 0);
    assert.ok(res.stdout.includes('Usage: mycli ask'));
    assert.ok(res.stdout.includes('--model'));
    assert.ok(res.stdout.includes('--stream'));
    assert.ok(res.stdout.includes('--no-stream'));
    assert.ok(res.stdout.includes('--web-search'));
  });

  test('mycli auth status shows not authenticated by default', async () => {
    const res = await runCli(['auth', 'status'], {
      PUTER_AUTH_TOKEN: '',
      MYCLI_AUTH_PATH: path.join(os.tmpdir(), `empty-auth-${Date.now()}.json`),
    });
    assert.strictEqual(res.code, 0);
    assert.ok(res.stdout.includes('Status:        Not authenticated'));
  });

  test('mycli auth status displays masked token when PUTER_AUTH_TOKEN is set', async () => {
    const res = await runCli(['auth', 'status'], {
      PUTER_AUTH_TOKEN: 'puter_secret_token_abcdef',
    });
    assert.strictEqual(res.code, 0);
    assert.ok(res.stdout.includes('Active Source: Environment Variable (PUTER_AUTH_TOKEN)'));
    assert.ok(res.stdout.includes('pute...cdef'));
  });

  test('mycli auth add, list, and remove manage multi-token pool', async () => {
    const testEnv = {
      PUTER_AUTH_TOKEN: '',
      MYCLI_AUTH_PATH: tempAuthFile,
    };

    // Add first token
    const add1 = await runCli(['auth', 'add', 'puter_token_pool_111111'], testEnv);
    assert.strictEqual(add1.code, 0);
    assert.ok(add1.stdout.includes('Token added successfully! Pool now contains 1 token(s).'));

    // Add second token
    const add2 = await runCli(['auth', 'add', 'puter_token_pool_222222'], testEnv);
    assert.strictEqual(add2.code, 0);
    assert.ok(add2.stdout.includes('Token added successfully! Pool now contains 2 token(s).'));

    // List tokens
    const listRes = await runCli(['auth', 'list'], testEnv);
    assert.strictEqual(listRes.code, 0);
    assert.ok(listRes.stdout.includes('Configured Puter Tokens (2 total)'));
    assert.ok(listRes.stdout.includes('pute...1111'));
    assert.ok(listRes.stdout.includes('pute...2222'));

    // Remove token 1
    const remRes = await runCli(['auth', 'remove', '1'], testEnv);
    assert.strictEqual(remRes.code, 0);
    assert.ok(remRes.stdout.includes('Removed token from pool.'));

    // List again to verify 1 left
    const listAfter = await runCli(['auth', 'list'], testEnv);
    assert.strictEqual(listAfter.code, 0);
    assert.ok(listAfter.stdout.includes('Configured Puter Tokens (1 total)'));
  });

  test('mycli ask without prompt exits with non-zero exit code 1', async () => {
    const res = await runCli(['ask']);
    assert.strictEqual(res.code, 1);
    assert.ok(res.stderr.includes('Error: No prompt provided.'));
  });

  test('mycli ask with invalid temperature exits with code 1', async () => {
    const res = await runCli(['ask', 'hello', '-t', '99']);
    assert.strictEqual(res.code, 1);
    assert.ok(res.stderr.includes('Error: Temperature must be a number between 0 and 2.'));
  });

  test('mycli ask with invalid token returns code 1 and clean Unauthorized message', async () => {
    const res = await runCli(['ask', 'Explain epoll.'], {
      PUTER_AUTH_TOKEN: 'invalid_dummy_token',
    });
    assert.strictEqual(res.code, 1);
    assert.ok(res.stderr.includes('Error: Authentication failed with Puter (401 Unauthorized)'));
  });

  test('mycli ask accepts piped input from stdin', async () => {
    const res = await runCli(['ask'], { PUTER_AUTH_TOKEN: 'invalid_dummy_token' }, 'Explain epoll.');
    assert.strictEqual(res.code, 1);
    assert.ok(res.stderr.includes('Error: Authentication failed with Puter (401 Unauthorized)'));
  });

  test('mycli models displays supported models table', async () => {
    const res = await runCli(['models']);
    assert.strictEqual(res.code, 0);
    assert.ok(res.stdout.includes('Puter AI Supported Models'));
    assert.ok(res.stdout.includes('gpt-5-nano'));
    assert.ok(res.stdout.includes('claude-sonnet-4.5'));
    assert.ok(res.stdout.includes('Common Model Aliases'));
  });

  test('mycli models --search filters models list', async () => {
    const res = await runCli(['models', '--search', 'claude']);
    assert.strictEqual(res.code, 0);
    assert.ok(res.stdout.includes('claude'));
  });
});

