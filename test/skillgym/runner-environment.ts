import { pathToFileURL } from 'node:url';

const SANDBOX_OVERRIDE_ENV = 'SKILLGYM_ALLOW_EXTERNAL_RUNNERS_IN_SANDBOX';

export function isNetworkRestrictedCodexSandbox(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.CODEX_SANDBOX_NETWORK_DISABLED === '1' || env.CODEX_SANDBOX_NETWORK_DISABLED === 'true'
  );
}

export function allowsExternalRunnersInSandbox(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SANDBOX_OVERRIDE_ENV] === '1' || env[SANDBOX_OVERRIDE_ENV] === 'true';
}

export function skillGymRunnerEnvironmentError(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!isNetworkRestrictedCodexSandbox(env) || allowsExternalRunnersInSandbox(env)) {
    return null;
  }

  return [
    'SkillGym uses external Codex and Claude runners, but this Codex sandbox has network disabled.',
    '',
    'Run this benchmark from a normal authenticated local shell:',
    '  pnpm test:skillgym',
    '',
    'For one case:',
    '  pnpm test:skillgym:case open-and-snapshot',
    '',
    `If your sandbox has approved network access and you intentionally want to run external runners, set ${SANDBOX_OVERRIDE_ENV}=1.`,
  ].join('\n');
}

export function enforceSkillGymRunnerEnvironment(): void {
  const message = skillGymRunnerEnvironmentError();
  if (!message) return;

  console.error(message);
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  enforceSkillGymRunnerEnvironment();
}
