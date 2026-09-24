import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { getAuthToken as puterGetAuthToken } from '@heyputer/puter.js/src/init.cjs';

export interface AuthStorageData {
  tokens: string[];
  currentIndex: number;
  token?: string; // backwards compatibility
  updatedAt?: string;
}

export interface ResolveAuthOptions {
  customAuthPath?: string;
  interactive?: boolean;
}

export interface AuthResult {
  token: string;
  tokens: string[];
  source: 'env' | 'cache' | 'browser';
}

/**
 * Get the path to the configuration directory.
 * Defaults to $XDG_CONFIG_HOME/mycli or ~/.config/mycli
 */
export function getConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig && xdgConfig.trim() !== '') {
    return path.join(xdgConfig, 'mycli');
  }
  return path.join(os.homedir(), '.config', 'mycli');
}

/**
 * Get the full path to the auth storage file.
 */
export function getAuthFilePath(customPath?: string): string {
  if (customPath && customPath.trim() !== '') {
    return path.resolve(customPath);
  }
  if (process.env.MYCLI_AUTH_PATH && process.env.MYCLI_AUTH_PATH.trim() !== '') {
    return path.resolve(process.env.MYCLI_AUTH_PATH.trim());
  }
  return path.join(getConfigDir(), 'auth.json');
}

/**
 * Read the list of cached tokens and the rotation index from disk.
 */
export function loadCachedTokens(customPath?: string): { tokens: string[]; currentIndex: number } {
  const filePath = getAuthFilePath(customPath);
  if (!fs.existsSync(filePath)) {
    return { tokens: [], currentIndex: 0 };
  }

  try {
    const rawContent = fs.readFileSync(filePath, 'utf-8').trim();
    if (!rawContent) {
      return { tokens: [], currentIndex: 0 };
    }

    try {
      const parsed = JSON.parse(rawContent);

      // Multi-token pool format: { tokens: ["..."], currentIndex: 0 }
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.tokens)) {
          const validTokens = parsed.tokens
            .filter((t: any) => typeof t === 'string' && t.trim() !== '')
            .map((t: string) => t.trim());
          const index = typeof parsed.currentIndex === 'number' && parsed.currentIndex >= 0
            ? parsed.currentIndex % Math.max(1, validTokens.length)
            : 0;
          return { tokens: validTokens, currentIndex: index };
        }

        // Single-token or comma-separated tokens in { token: "..." }
        const candidate = parsed.token || parsed.authToken || parsed.access_token;
        if (typeof candidate === 'string' && candidate.trim() !== '') {
          const split = candidate
            .split(',')
            .map((t: string) => t.trim())
            .filter((t: string) => t.length > 0);
          return { tokens: split, currentIndex: 0 };
        }
      }

      // Plain string JSON string format
      if (typeof parsed === 'string' && parsed.trim() !== '') {
        return { tokens: [parsed.trim()], currentIndex: 0 };
      }
    } catch {
      // Fallback: If not JSON, check if it's a plain string token
      if (rawContent.length > 10 && !rawContent.includes('\n')) {
        return { tokens: [rawContent], currentIndex: 0 };
      }
    }
  } catch {
    return { tokens: [], currentIndex: 0 };
  }

  return { tokens: [], currentIndex: 0 };
}

/**
 * Persist the token pool to disk securely with 0o600 permissions.
 */
export function saveCachedTokens(tokens: string[], currentIndex: number = 0, customPath?: string): void {
  const validTokens = tokens
    .filter((t) => typeof t === 'string' && t.trim() !== '')
    .map((t) => t.trim());

  if (validTokens.length === 0) {
    clearCachedToken(customPath);
    return;
  }

  const filePath = getAuthFilePath(customPath);
  const dirPath = path.dirname(filePath);

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }

  const payload: AuthStorageData = {
    tokens: validTokens,
    currentIndex: currentIndex % validTokens.length,
    updatedAt: new Date().toISOString(),
  };

  const tempFilePath = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tempFilePath, JSON.stringify(payload, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });

  fs.renameSync(tempFilePath, filePath);

  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignore chmod errors on systems that don't support it
  }
}

/**
 * Add a new token to the rotation pool.
 */
export function addToken(token: string, customPath?: string): { tokens: string[]; count: number } {
  if (!token || typeof token !== 'string' || token.trim() === '') {
    throw new Error('Cannot add empty authentication token.');
  }

  const trimmed = token.trim();
  const { tokens, currentIndex } = loadCachedTokens(customPath);

  if (!tokens.includes(trimmed)) {
    tokens.push(trimmed);
    saveCachedTokens(tokens, currentIndex, customPath);
  }

  return { tokens, count: tokens.length };
}

/**
 * Remove a token by index (1-based or 0-based) or by exact token value.
 */
export function removeToken(identifier: string | number, customPath?: string): boolean {
  const { tokens, currentIndex } = loadCachedTokens(customPath);
  if (tokens.length === 0) return false;

  let indexToRemove = -1;

  if (typeof identifier === 'number') {
    indexToRemove = identifier;
  } else if (/^\d+$/.test(identifier.trim())) {
    // 1-based index support
    const parsedIdx = parseInt(identifier.trim(), 10) - 1;
    if (parsedIdx >= 0 && parsedIdx < tokens.length) {
      indexToRemove = parsedIdx;
    }
  } else {
    // Match exact token or substring
    indexToRemove = tokens.findIndex((t) => t === identifier.trim() || t.includes(identifier.trim()));
  }

  if (indexToRemove >= 0 && indexToRemove < tokens.length) {
    tokens.splice(indexToRemove, 1);
    const newIndex = tokens.length > 0 ? currentIndex % tokens.length : 0;
    saveCachedTokens(tokens, newIndex, customPath);
    return true;
  }

  return false;
}

/**
 * Read the active cached token from disk, if available.
 */
export function loadCachedToken(customPath?: string): string | null {
  const { tokens, currentIndex } = loadCachedTokens(customPath);
  if (tokens.length === 0) {
    return null;
  }
  return tokens[currentIndex % tokens.length];
}

/**
 * Persist a single authentication token (replaces or sets initial token).
 */
export function saveCachedToken(token: string, customPath?: string): void {
  if (!token || typeof token !== 'string' || token.trim() === '') {
    throw new Error('Cannot persist empty authentication token.');
  }
  saveCachedTokens([token], 0, customPath);
}

/**
 * Rotate to the next token in the pool and update the rotation index.
 */
export function rotateToNextToken(customPath?: string): string | null {
  const { tokens, currentIndex } = loadCachedTokens(customPath);
  if (tokens.length === 0) return null;

  const nextIndex = (currentIndex + 1) % tokens.length;
  saveCachedTokens(tokens, nextIndex, customPath);
  return tokens[nextIndex];
}

/**
 * Delete the cached credentials file from disk.
 */
export function clearCachedToken(customPath?: string): boolean {
  const filePath = getAuthFilePath(customPath);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Check if running in a headless or CI environment without browser access.
 */
export function isHeadlessEnvironment(): boolean {
  const isCI = Boolean(process.env.CI || process.env.CONTINUOUS_INTEGRATION);
  const hasDisplay = Boolean(
    process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.platform === 'darwin' || process.platform === 'win32'
  );
  return isCI || (!process.stdout.isTTY && !hasDisplay);
}

/**
 * Trigger Puter browser authentication using getAuthToken().
 */
export async function authenticateViaBrowser(): Promise<string> {
  if (isHeadlessEnvironment()) {
    throw new Error(
      'Cannot open browser authentication in a headless or CI environment without a display.\n' +
      'Please set the PUTER_AUTH_TOKEN environment variable directly:\n' +
      '  export PUTER_AUTH_TOKEN="your_puter_auth_token"'
    );
  }

  process.stderr.write('No cached Puter credentials found. Opening browser for login...\n');

  let activeServer: http.Server | null = null;
  const originalCreateServer = http.createServer;

  http.createServer = function (...args: any[]) {
    const server = (originalCreateServer as any).apply(this, args);
    activeServer = server;
    server.unref();

    const originalListen = server.listen;
    server.listen = function (...listenArgs: any[]) {
      const listenerCallback = typeof listenArgs[listenArgs.length - 1] === 'function'
        ? listenArgs.pop()
        : null;

      return originalListen.call(this, ...listenArgs, function (this: http.Server) {
        const addr = this.address();
        if (addr && typeof addr === 'object') {
          const authUrl = `https://puter.com/?action=authme&redirectURL=${encodeURIComponent(`http://localhost:${addr.port}`)}`;
          process.stderr.write(`\nIf the browser does not open automatically, open this URL:\n  ${authUrl}\n\nWaiting for authentication...\n`);
        }
        if (listenerCallback) {
          listenerCallback.call(this);
        }
      });
    };

    return server;
  };

  try {
    const token = await puterGetAuthToken();
    if (!token || typeof token !== 'string' || token.trim() === '') {
      throw new Error('Authentication failed: no token received from Puter authentication callback.');
    }
    process.stderr.write('Authentication successful!\n');
    return token.trim();
  } finally {
    http.createServer = originalCreateServer;
    if (activeServer) {
      try {
        (activeServer as http.Server).close();
      } catch {
        // Ignore
      }
    }
  }
}

// In-memory counter for environment variable tokens rotation
let envTokensCounter = 0;

/**
 * Authentication logic with rotation support:
 * 1. If PUTER_AUTH_TOKEN exists, parse single or comma-separated tokens and rotate.
 * 2. Otherwise load cached tokens pool, choose active token, and advance index.
 * 3. If no tokens exist, trigger browser login, cache the token, and return it.
 */
export async function resolveAuthToken(options?: ResolveAuthOptions): Promise<AuthResult> {
  // 1. Check environment variable override (supports single or comma-separated list)
  const envToken = process.env.PUTER_AUTH_TOKEN;
  if (envToken && envToken.trim() !== '') {
    const envTokens = envToken
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (envTokens.length > 0) {
      const active = envTokens[envTokensCounter % envTokens.length];
      envTokensCounter = (envTokensCounter + 1) % envTokens.length;
      return {
        token: active,
        tokens: envTokens,
        source: 'env',
      };
    }
  }

  // 2. Check cached token pool on disk
  const { tokens, currentIndex } = loadCachedTokens(options?.customAuthPath);
  if (tokens.length > 0) {
    const active = tokens[currentIndex % tokens.length];
    // Advance rotation index for the next query
    const nextIndex = (currentIndex + 1) % tokens.length;
    saveCachedTokens(tokens, nextIndex, options?.customAuthPath);

    return {
      token: active,
      tokens,
      source: 'cache',
    };
  }

  // 3. Complete browser authentication and persist initial token
  const freshToken = await authenticateViaBrowser();
  saveCachedTokens([freshToken], 0, options?.customAuthPath);

  return {
    token: freshToken,
    tokens: [freshToken],
    source: 'browser',
  };
}
