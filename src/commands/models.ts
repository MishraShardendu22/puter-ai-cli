import { Command } from 'commander';
import { resolveAuthToken } from '../auth.js';
import { PuterProvider } from '../providers/puter.js';
import { POPULAR_MODELS, MODEL_ALIASES, type ModelInfo } from '../models.js';

export function registerModelsCommand(program: Command): void {
  program
    .command('models')
    .description('List available AI models on Puter, alias mappings, and context limits')
    .option('-a, --all', 'List all available models from Puter catalog (including openrouter)')
    .option('-s, --search <query>', 'Filter models by name, ID, or provider')
    .action(async (options: { all?: boolean; search?: string }) => {
      let models: ModelInfo[] = POPULAR_MODELS;

      // Try fetching live catalog if authenticated
      const resolved = await resolveAuthToken();
      if (resolved) {
        try {
          const provider = new PuterProvider({ authToken: resolved.token });
          const liveModels = await provider.listModels();
          if (liveModels && liveModels.length > 0) {
            models = liveModels;
          }
        } catch {
          // Fall back silently to POPULAR_MODELS
        }
      }

      // Filter by search query if provided
      if (options.search) {
        const q = options.search.toLowerCase();
        models = models.filter(
          (m) =>
            m.id.toLowerCase().includes(q) ||
            m.name.toLowerCase().includes(q) ||
            (m.provider && m.provider.toLowerCase().includes(q))
        );
      } else if (!options.all) {
        // By default, filter out batch and raw internal IDs unless requested
        const popularIds = new Set(POPULAR_MODELS.map((p) => p.id));
        const filtered = models.filter((m) => {
          if (m.id.endsWith(':batch')) return false;
          if (popularIds.has(m.id)) return true;
          // Include clean high-level models
          return !m.id.includes('openrouter:') || m.id.includes('claude-');
        });
        if (filtered.length > 0) {
          models = filtered;
        }
      }

      process.stdout.write('\n--- Puter AI Supported Models ---\n\n');
      process.stdout.write(
        `${'Model ID'.padEnd(28)} ${'Provider'.padEnd(14)} ${'Context'.padEnd(10)} ${'Notes / Description'}\n`
      );
      process.stdout.write(`${'-'.repeat(28)} ${'-'.repeat(14)} ${'-'.repeat(10)} ${'-'.repeat(30)}\n`);

      for (const m of models) {
        const idCol = (m.id.length > 26 ? m.id.slice(0, 24) + '..' : m.id).padEnd(28);
        const provCol = (m.provider || 'Puter').padEnd(14);
        const ctxCol = (m.context ? `${Math.round(m.context / 1000)}k` : '-').padEnd(10);
        const desc = m.description || m.name || '';
        process.stdout.write(`${idCol} ${provCol} ${ctxCol} ${desc}\n`);
      }

      process.stdout.write('\nCommon Model Aliases (Auto-Resolved):\n');
      const sampleAliases: [string, string][] = [
        ['claude-3-5-sonnet / claude-3.5', 'claude-sonnet-4.5'],
        ['claude-3-5-haiku / claude-haiku', 'claude-haiku-4.5'],
        ['claude-3-opus / claude-opus', 'claude-opus-4.5'],
        ['gpt-4 / gpt4', 'gpt-4o'],
        ['gpt-5 / gpt-3.5', 'gpt-5-nano'],
        ['deepseek / deepseek-v3', 'deepseek-chat'],
      ];
      for (const [alias, target] of sampleAliases) {
        process.stdout.write(`  ${alias.padEnd(34)} -> ${target}\n`);
      }
      process.stdout.write('\nRun with "--all" to view all extended models, or "--search <term>" to filter.\n\n');
    });
}
