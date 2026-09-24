#!/usr/bin/env node

// Suppress internal Node deprecation/experimental warnings originating from Puter's bundled dependencies
const originalEmitWarning = process.emitWarning;
process.emitWarning = function (warning: any, ...args: any[]) {
  if (
    (typeof warning === 'string' && (warning.includes('sys is deprecated') || warning.includes('WASI'))) ||
    (warning && typeof warning === 'object' && (warning.name === 'DeprecationWarning' || warning.name === 'ExperimentalWarning'))
  ) {
    return;
  }
  return (originalEmitWarning as any).call(process, warning, ...args);
};

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerAskCommand } from './commands/ask.js';
import {
  loadCachedTokens,
  addToken,
  removeToken,
  saveCachedToken,
  clearCachedToken,
  getAuthFilePath,
  authenticateViaBrowser,
} from './auth.js';

// Setup top-level unhandled exception handling
process.on('uncaughtException', (err: Error) => {
  process.stderr.write(`Fatal Error: ${err.message}\n`);
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  process.stderr.write(`Fatal Error: ${reason?.message || reason}\n`);
  process.exit(1);
});

function maskToken(token: string): string {
  if (token.length <= 8) return '****';
  return token.slice(0, 4) + '...' + token.slice(-4);
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('mycli')
    .description('A fast and reliable CLI AI provider powered by Puter.js without requiring an OpenAI API key')
    .version('1.0.0');

  // Register primary 'ask' command
  registerAskCommand(program);

  // Authentication utility commands for managing Puter credentials
  const authCmd = program
    .command('auth')
    .description('Manage Puter authentication, multi-token pools, and rotation');

  authCmd
    .command('status')
    .description('Display current authentication status, token pool count, and storage path')
    .action(() => {
      const envToken = process.env.PUTER_AUTH_TOKEN;
      const { tokens, currentIndex } = loadCachedTokens();
      const filePath = getAuthFilePath();

      process.stdout.write('--- Puter Authentication Status ---\n');
      if (envToken && envToken.trim() !== '') {
        const envTokens = envToken.split(',').map((t) => t.trim()).filter(Boolean);
        process.stdout.write(`Active Source: Environment Variable (PUTER_AUTH_TOKEN)\n`);
        process.stdout.write(`Token Pool:    ${envTokens.length} token(s) configured\n`);
        envTokens.forEach((t, i) => {
          process.stdout.write(`  [${i + 1}] ${maskToken(t)}\n`);
        });
      } else if (tokens.length > 0) {
        process.stdout.write(`Active Source: Cached credentials file\n`);
        process.stdout.write(`Token Pool:    ${tokens.length} token(s) configured (Round-Robin enabled)\n`);
        process.stdout.write(`Active Token:  [${(currentIndex % tokens.length) + 1}/${tokens.length}] ${maskToken(tokens[currentIndex % tokens.length])}\n`);
        process.stdout.write(`Storage Path:  ${filePath}\n`);
      } else {
        process.stdout.write('Status:        Not authenticated\n');
        process.stdout.write('Next Step:     Run "mycli ask <prompt>" to log in via browser, or run "mycli auth add <token>".\n');
      }
    });

  authCmd
    .command('add <token>')
    .description('Add a Puter token to the rotation pool')
    .action((tokenArg: string) => {
      try {
        const { count } = addToken(tokenArg);
        process.stdout.write(`Token added successfully! Pool now contains ${count} token(s).\n`);
      } catch (err: any) {
        process.stderr.write(`Failed to add token: ${err.message}\n`);
        process.exitCode = 1;
      }
    });

  authCmd
    .command('list')
    .description('List all Puter tokens in the rotation pool')
    .action(() => {
      const { tokens, currentIndex } = loadCachedTokens();
      if (tokens.length === 0) {
        process.stdout.write('No tokens in pool. Add one using "mycli auth add <token>" or "mycli auth login".\n');
        return;
      }

      process.stdout.write(`--- Configured Puter Tokens (${tokens.length} total) ---\n`);
      tokens.forEach((t, i) => {
        const isCurrent = i === (currentIndex % tokens.length);
        const marker = isCurrent ? ' (active next)' : '';
        process.stdout.write(`  ${i + 1}. ${maskToken(t)}${marker}\n`);
      });
    });

  authCmd
    .command('remove <identifier>')
    .description('Remove a token by position (e.g. 1, 2) or token string')
    .action((identifier: string) => {
      const removed = removeToken(identifier);
      if (removed) {
        process.stdout.write(`Removed token from pool.\n`);
      } else {
        process.stderr.write(`No matching token found to remove.\n`);
        process.exitCode = 1;
      }
    });

  authCmd
    .command('login')
    .description('Trigger browser login to acquire a new Puter authentication token')
    .action(async () => {
      try {
        const token = await authenticateViaBrowser();
        const { count } = addToken(token);
        process.stdout.write(`Successfully authenticated! Token pool now has ${count} token(s).\n`);
      } catch (err: any) {
        process.stderr.write(`Login failed: ${err.message}\n`);
        process.exitCode = 1;
      }
    });

  authCmd
    .command('logout')
    .description('Remove all cached authentication credentials from disk')
    .action(() => {
      const removed = clearCachedToken();
      if (removed) {
        process.stdout.write(`Removed all cached credentials at: ${getAuthFilePath()}\n`);
      } else {
        process.stdout.write('No cached credentials file found.\n');
      }
    });

  return program;
}

export async function run(): Promise<void> {
  const program = createProgram();
  await program.parseAsync(process.argv);

  if (process.exitCode && process.exitCode !== 0) {
    process.exit(process.exitCode);
  }
}

function isMain(): boolean {
  if (!process.argv[1]) return false;
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const invokedFile = fs.realpathSync(process.argv[1]);
    return currentFile === invokedFile;
  } catch {
    return false;
  }
}

// Execute when invoked directly as CLI entrypoint
if (isMain()) {
  run().catch((error) => {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(1);
  });
}
