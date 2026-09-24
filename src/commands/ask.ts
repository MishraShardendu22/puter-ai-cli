import { Command } from 'commander';
import { resolveAuthToken } from '../auth.js';
import { PuterProvider, PuterError } from '../providers/puter.js';

export interface AskCommandOptions {
  model?: string;
  stream?: boolean;
  temperature?: string;
  customAuthPath?: string;
}

/**
 * Reads piped input from stdin if available and not connected to an interactive TTY.
 */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return '';
  }

  if (process.stdin.readableEnded) {
    return '';
  }

  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data.trim());
    });
    process.stdin.on('error', () => {
      resolve('');
    });
  });
}

/**
 * Execute the ask command with the given prompt and options.
 * Supports token pool rotation and automatic failover on quota/rate-limits.
 */
export async function executeAsk(
  promptArgs: string[],
  options: AskCommandOptions
): Promise<void> {
  let prompt = promptArgs.join(' ').trim();

  // If no prompt provided as arguments, try reading from standard input
  if (!prompt) {
    prompt = await readStdin();
  }

  if (!prompt) {
    process.stderr.write(
      'Error: No prompt provided.\n' +
      'Usage:\n' +
      '  mycli ask "Explain epoll."\n' +
      '  echo "Explain epoll." | mycli ask\n'
    );
    process.exitCode = 1;
    return;
  }

  const temperature = options.temperature ? parseFloat(options.temperature) : undefined;
  if (temperature !== undefined && (isNaN(temperature) || temperature < 0 || temperature > 2)) {
    process.stderr.write('Error: Temperature must be a number between 0 and 2.\n');
    process.exitCode = 1;
    return;
  }

  try {
    // Resolve authentication tokens
    const authResult = await resolveAuthToken({
      customAuthPath: options.customAuthPath,
    });

    const stream = options.stream ?? true;
    const tokensToTry = [authResult.token];

    // Add remaining pool tokens for failover if multiple tokens exist
    for (const t of authResult.tokens) {
      if (!tokensToTry.includes(t)) {
        tokensToTry.push(t);
      }
    }

    let lastError: any = null;
    let succeeded = false;

    for (let i = 0; i < tokensToTry.length; i++) {
      const currentToken = tokensToTry[i];
      const provider = new PuterProvider({ authToken: currentToken });

      try {
        let endsWithNewline = false;
        let receivedAnyChunk = false;

        for await (const chunk of provider.chatStream(prompt, {
          model: options.model,
          stream,
          temperature,
        })) {
          receivedAnyChunk = true;
          process.stdout.write(chunk);
          endsWithNewline = chunk.endsWith('\n');
        }

        if (receivedAnyChunk && !endsWithNewline) {
          process.stdout.write('\n');
        }

        succeeded = true;
        break; // Query completed successfully
      } catch (err: any) {
        lastError = err;
        const isQuotaOrRateLimit = err instanceof PuterError && (err.statusCode === 429 || err.statusCode === 401);
        const hasMoreTokens = i + 1 < tokensToTry.length;

        if (isQuotaOrRateLimit && hasMoreTokens) {
          process.stderr.write(
            `\n[Notice] Token ${i + 1}/${tokensToTry.length} exceeded quota or failed (${err.statusCode || 'RateLimit'}). Automatically rotating to next token...\n`
          );
          continue; // Try next token
        }

        // Fatal error or no more tokens
        throw err;
      }
    }

    if (!succeeded && lastError) {
      throw lastError;
    }
  } catch (error: any) {
    process.stderr.write(`Error: ${error?.message || error}\n`);
    process.exitCode = 1;
  }
}

/**
 * Register the 'ask' command onto the Commander program instance.
 */
export function registerAskCommand(program: Command): void {
  program
    .command('ask')
    .description('Ask a prompt to Puter AI and print or stream the answer')
    .argument('[prompt...]', 'The prompt or question to ask Puter AI')
    .option('-m, --model <model>', 'Puter AI model name to use (e.g., gpt-5-nano, claude-3-5-sonnet)')
    .option('--stream', 'Stream responses token by token (default)', true)
    .option('--no-stream', 'Disable streaming and wait for complete response')
    .option('-t, --temperature <temperature>', 'Sampling temperature between 0 and 2')
    .option('--auth-file <path>', 'Custom path for token storage')
    .action(async (promptArgs: string[], options: AskCommandOptions) => {
      await executeAsk(promptArgs, options);
    });
}
