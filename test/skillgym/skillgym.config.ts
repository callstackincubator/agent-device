import type { SkillGymConfig } from 'skillgym';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const localBinDir = fileURLToPath(new URL('./bin', import.meta.url));
const runnerEnv = {
  PATH: [localBinDir, process.env.PATH].filter(Boolean).join(path.delimiter),
};

const config: SkillGymConfig = {
  run: {
    // Relative to this config file; points SkillGym at the repository root.
    cwd: '../..',
    outputDir: './.skillgym-results',
    reporter: 'standard',
    schedule: 'isolated-by-runner',
  },
  defaults: {
    timeoutMs: 600_000,
  },
  runners: {
    'codex-mini': {
      agent: {
        type: 'codex',
        model: 'gpt-5.4-mini',
        env: runnerEnv,
      },
    },
    'claude-haiku': {
      agent: {
        type: 'claude-code',
        model: 'haiku',
        env: runnerEnv,
      },
    },
  },
};

export default config;
