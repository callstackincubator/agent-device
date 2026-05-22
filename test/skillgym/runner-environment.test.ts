import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowsExternalRunnersInSandbox,
  isNetworkRestrictedCodexSandbox,
  skillGymRunnerEnvironmentError,
} from './runner-environment.ts';

test('detects network-restricted Codex sandboxes', () => {
  assert.equal(isNetworkRestrictedCodexSandbox({ CODEX_SANDBOX_NETWORK_DISABLED: '1' }), true);
  assert.equal(isNetworkRestrictedCodexSandbox({ CODEX_SANDBOX_NETWORK_DISABLED: 'true' }), true);
  assert.equal(isNetworkRestrictedCodexSandbox({ CODEX_SANDBOX_NETWORK_DISABLED: '0' }), false);
  assert.equal(isNetworkRestrictedCodexSandbox({}), false);
});

test('allows explicit SkillGym sandbox override', () => {
  assert.equal(
    allowsExternalRunnersInSandbox({ SKILLGYM_ALLOW_EXTERNAL_RUNNERS_IN_SANDBOX: '1' }),
    true,
  );
  assert.equal(
    allowsExternalRunnersInSandbox({ SKILLGYM_ALLOW_EXTERNAL_RUNNERS_IN_SANDBOX: 'true' }),
    true,
  );
  assert.equal(allowsExternalRunnersInSandbox({}), false);
});

test('explains why external SkillGym runners are blocked in restricted sandboxes', () => {
  const message = skillGymRunnerEnvironmentError({
    CODEX_SANDBOX_NETWORK_DISABLED: '1',
  });

  assert.match(message ?? '', /external Codex and Claude runners/);
  assert.match(message ?? '', /pnpm test:skillgym:case open-and-snapshot/);
  assert.match(message ?? '', /SKILLGYM_ALLOW_EXTERNAL_RUNNERS_IN_SANDBOX=1/);
});

test('does not block normal local SkillGym runs', () => {
  assert.equal(skillGymRunnerEnvironmentError({}), null);
  assert.equal(
    skillGymRunnerEnvironmentError({
      CODEX_SANDBOX_NETWORK_DISABLED: '1',
      SKILLGYM_ALLOW_EXTERNAL_RUNNERS_IN_SANDBOX: '1',
    }),
    null,
  );
});
