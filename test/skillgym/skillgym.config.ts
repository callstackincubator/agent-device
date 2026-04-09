import type { SkillGymConfig } from 'skillgym';

const config: SkillGymConfig = {
  run: {
    // Relative to this config file; points SkillGym at the repository root.
    cwd: '../..',
    outputDir: './.skillgym-results',
    reporter: 'standard',
    schedule: 'parallel',
  },
  defaults: {
    timeoutMs: 120_000,
  },
  runners: {
    'codex-main': {
      agent: {
        type: 'codex',
        model: 'gpt-5.4-mini',
      },
    },
    'claude-haiku': {
      agent: {
        type: 'claude-code',
        model: 'haiku',
      },
    },
  },
};

export default config;
