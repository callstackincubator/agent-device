import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppError } from '../../../utils/errors.ts';
import type { DaemonRequest, DaemonResponse, SessionAction } from '../../types.ts';
import type { CommandFlags } from '../../../core/dispatch.ts';
import { SessionStore } from '../../session-store.ts';
import {
  buildReplayVarScope,
  collectReplayShellEnv,
  parseReplayCliEnvEntries,
  resolveReplayAction,
  resolveReplayString,
} from '../session-replay-vars.ts';
import {
  parseReplayScript,
  parseReplayScriptDetailed,
  readReplayScriptMetadata,
} from '../session-replay-script.ts';
import { runReplayScriptFile } from '../session-replay-runtime.ts';

const LOC = { file: 'test.ad', line: 1 };

type CapturedInvocation = {
  command: string;
  positionals?: string[];
  flags?: Record<string, unknown>;
};

async function runReplayFixture(params: {
  label: string;
  script: string;
  flags?: CommandFlags;
  invoke?: (req: DaemonRequest) => Promise<DaemonResponse>;
}): Promise<{
  response: DaemonResponse;
  calls: CapturedInvocation[];
  root: string;
  scriptPath: string;
}> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `agent-device-replay-${params.label}-`));
  const scriptPath = path.join(root, 'flow.ad');
  fs.writeFileSync(scriptPath, params.script);
  const calls: CapturedInvocation[] = [];
  const defaultInvoke = async (req: DaemonRequest): Promise<DaemonResponse> => {
    calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
    return { ok: true, data: {} };
  };
  const response = await runReplayScriptFile({
    req: {
      token: 't',
      session: 's',
      command: 'replay',
      positionals: [scriptPath],
      flags: params.flags ?? {},
      meta: { cwd: root },
    },
    sessionName: 's',
    logPath: path.join(root, 'log'),
    sessionStore: new SessionStore(path.join(root, 'state')),
    invoke: params.invoke ?? defaultInvoke,
  });
  return { response, calls, root, scriptPath };
}

test('resolveReplayString substitutes variables', () => {
  const scope = buildReplayVarScope({ fileEnv: { APP: 'settings' } });
  assert.equal(resolveReplayString('open ${APP}', scope, LOC), 'open settings');
});

test('resolveReplayString supports fallback with :-default', () => {
  const scope = buildReplayVarScope({});
  assert.equal(
    resolveReplayString('wait ${WAIT_SHORT:-500}', scope, LOC),
    'wait 500',
  );
});

test('resolveReplayString prefers scope value over fallback', () => {
  const scope = buildReplayVarScope({ fileEnv: { WAIT_SHORT: '1000' } });
  assert.equal(
    resolveReplayString('wait ${WAIT_SHORT:-500}', scope, LOC),
    'wait 1000',
  );
});

test('resolveReplayString fallback preserves embedded braces via escapes', () => {
  const scope = buildReplayVarScope({});
  assert.equal(
    resolveReplayString('x ${A:-one\\}two}', scope, LOC),
    'x one}two',
  );
});

test('resolveReplayString supports escape for literal $', () => {
  const scope = buildReplayVarScope({ fileEnv: { APP: 'settings' } });
  assert.equal(resolveReplayString('\\${APP}', scope, LOC), '${APP}');
});

test('resolveReplayString throws on unresolved variable with file:line', () => {
  const scope = buildReplayVarScope({ fileEnv: { OTHER: 'x' } });
  assert.throws(
    () => resolveReplayString('open ${MISSING}', scope, { file: 'a.ad', line: 7 }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /Unresolved variable \$\{MISSING\} at a\.ad:7/.test(error.message),
  );
});

test('resolveReplayString is case-sensitive', () => {
  const scope = buildReplayVarScope({ fileEnv: { APP: 'settings' } });
  assert.throws(() => resolveReplayString('${app}', scope, LOC), AppError);
});

test('resolveReplayString substitutes multiple vars on one line', () => {
  const scope = buildReplayVarScope({ fileEnv: { A: '1', B: '2' } });
  assert.equal(resolveReplayString('${A}-${B}-${A}', scope, LOC), '1-2-1');
});

test('buildReplayVarScope precedence: cli > shell > file > builtin', () => {
  const scope = buildReplayVarScope({
    builtins: { K: 'builtin' },
    fileEnv: { K: 'file' },
    shellEnv: { K: 'shell' },
    cliEnv: { K: 'cli' },
  });
  assert.equal(scope.values.K, 'cli');

  const shellWinsOverFile = buildReplayVarScope({
    fileEnv: { K: 'file' },
    shellEnv: { K: 'shell' },
  });
  assert.equal(shellWinsOverFile.values.K, 'shell');
});

test('collectReplayShellEnv strips AD_VAR_ prefix and ignores other vars', () => {
  const result = collectReplayShellEnv({
    AD_VAR_APP_ID: 'settings',
    PATH: '/bin',
    AD_VAR_123: 'x',
    AD_VAR_: 'empty',
    OTHER_VAR: 'y',
    AD_APP_ID: 'no-legacy-prefix',
  });
  assert.equal(result.APP_ID, 'settings');
  assert.equal(result.PATH, undefined);
  assert.equal(result['123'], undefined);
  assert.equal(result[''], undefined);
  // legacy AD_* (non AD_VAR_*) is no longer auto-imported.
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'AD_APP_ID'), false);
});

test('collectReplayShellEnv skips keys that land in reserved AD_* namespace after strip', () => {
  const result = collectReplayShellEnv({
    AD_VAR_AD_SESSION: 'evil',
    AD_VAR_AD_FOO: 'evil',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'AD_SESSION'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'AD_FOO'), false);
});

test('parseReplayCliEnvEntries splits KEY=VALUE and rejects invalid keys', () => {
  assert.deepEqual(
    parseReplayCliEnvEntries(['APP=settings', 'FOO=bar=baz']),
    { APP: 'settings', FOO: 'bar=baz' },
  );
  assert.throws(() => parseReplayCliEnvEntries(['NOEQUAL']), AppError);
  assert.throws(() => parseReplayCliEnvEntries(['lower=x']), AppError);
  assert.throws(() => parseReplayCliEnvEntries(['=value']), AppError);
});

test('resolveReplayAction walks positionals and string flags', () => {
  const action: SessionAction = {
    ts: 0,
    command: 'snapshot',
    positionals: ['${FOO}'],
    flags: {
      snapshotScope: '${SCOPE}',
      snapshotInteractiveOnly: true,
      snapshotDepth: 3,
    },
  };
  const scope = buildReplayVarScope({ fileEnv: { FOO: 'bar', SCOPE: 'app' } });
  const resolved = resolveReplayAction(action, scope, LOC);
  assert.deepEqual(resolved.positionals, ['bar']);
  assert.equal(resolved.flags?.snapshotScope, 'app');
  assert.equal(resolved.flags?.snapshotInteractiveOnly, true);
  assert.equal(resolved.flags?.snapshotDepth, 3);
});

test('resolveReplayAction walks runtime hints', () => {
  const action: SessionAction = {
    ts: 0,
    command: 'open',
    positionals: [],
    runtime: { platform: 'android', metroHost: '${HOST}' },
    flags: {},
  };
  const scope = buildReplayVarScope({ fileEnv: { HOST: '10.0.0.1' } });
  const resolved = resolveReplayAction(action, scope, LOC);
  assert.equal(resolved.runtime?.metroHost, '10.0.0.1');
});

test('JSON-quoted args round-trip with ${VAR} intact after parse', () => {
  const script = 'context platform=android\nenv SEL="label=Wait || label=Apps"\nclick "${SEL}"\n';
  const actions = parseReplayScript(script);
  assert.deepEqual(actions[0]?.positionals, ['${SEL}']);
});

test('parseReplayScriptDetailed tracks line numbers', () => {
  const script = [
    '# comment',
    'context platform=android',
    'env APP=settings',
    '',
    'open ${APP}',
    'wait 500',
  ].join('\n');
  const parsed = parseReplayScriptDetailed(script);
  assert.equal(parsed.actions.length, 2);
  assert.deepEqual(parsed.actionLines, [5, 6]);
});

test('readReplayScriptMetadata parses env KEY=VALUE directives', () => {
  const metadata = readReplayScriptMetadata(
    'context platform=android\nenv APP=settings\nenv WAIT=500\nopen ${APP}\n',
  );
  assert.equal(metadata.env?.APP, 'settings');
  assert.equal(metadata.env?.WAIT, '500');
});

test('readReplayScriptMetadata accepts env before context', () => {
  const metadata = readReplayScriptMetadata('env APP=settings\ncontext platform=android\n');
  assert.equal(metadata.platform, 'android');
  assert.equal(metadata.env?.APP, 'settings');
});

test('readReplayScriptMetadata parses quoted env values with spaces', () => {
  const metadata = readReplayScriptMetadata(
    'context platform=android\nenv SEL="label=Wait || label=Apps"\n',
  );
  assert.equal(metadata.env?.SEL, 'label=Wait || label=Apps');
});

test('readReplayScriptMetadata rejects invalid env key', () => {
  assert.throws(
    () =>
      readReplayScriptMetadata('context platform=android\nenv lower=settings\n'),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /Invalid env key "lower"/.test(error.message),
  );
});

test('readReplayScriptMetadata rejects duplicate env key', () => {
  assert.throws(
    () =>
      readReplayScriptMetadata(
        'context platform=android\nenv APP=a\nenv APP=b\n',
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /Duplicate env directive "APP"/.test(error.message),
  );
});

test('parseReplayScript rejects env after first action', () => {
  assert.throws(
    () =>
      parseReplayScript(
        'context platform=android\nopen settings\nenv APP=late\n',
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /env directives must precede all actions/.test(error.message),
  );
});

test('runReplayScriptFile rejects replay -u on scripts with env directives', async () => {
  const { response } = await runReplayFixture({
    label: 'env-heal',
    script: 'context platform=android\nenv APP=settings\nopen ${APP}\n',
    flags: { replayUpdate: true },
  });
  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(response.error.message, /replay -u does not yet preserve env directives/);
  }
});

test('resolveReplayAction produces dispatch-ready literals for a realistic fixture', () => {
  const script = [
    'context platform=android',
    'env APP_ID=settings',
    'env WAIT_SHORT=500',
    'env SETTINGS_ITEMS="label=Wait || label=Apps"',
    '',
    'open ${APP_ID} --relaunch',
    'wait ${WAIT_SHORT}',
    'click "${SETTINGS_ITEMS}"',
    'is exists "${SETTINGS_ITEMS}"',
    'snapshot -s "${SNAPSHOT_SCOPE:-app}"',
  ].join('\n');
  const metadata = readReplayScriptMetadata(script);
  const parsed = parseReplayScriptDetailed(script);
  const scope = buildReplayVarScope({
    builtins: { AD_PLATFORM: 'android' },
    fileEnv: metadata.env,
    shellEnv: { APP_ID: 'shell-wins' },
    cliEnv: { APP_ID: 'cli-wins' },
  });
  const resolved = parsed.actions.map((action, index) =>
    resolveReplayAction(action, scope, {
      file: 'fixture.ad',
      line: parsed.actionLines[index] ?? 0,
    }),
  );
  assert.deepEqual(resolved[0]?.positionals, ['cli-wins']);
  assert.equal(resolved[0]?.flags.relaunch, true);
  assert.deepEqual(resolved[1]?.positionals, ['500']);
  assert.deepEqual(resolved[2]?.positionals, ['label=Wait || label=Apps']);
  assert.deepEqual(resolved[3]?.positionals, ['exists', 'label=Wait || label=Apps']);
  assert.equal(resolved[4]?.flags.snapshotScope, 'app');
});

test.each([
  {
    name: 'file env via parseReplayEnvLine',
    run: () => readReplayScriptMetadata('context platform=android\nenv AD_FOO=bar\n'),
    keyMatch: /AD_FOO/,
  },
  {
    name: 'CLI -e via parseReplayCliEnvEntries',
    run: () => parseReplayCliEnvEntries(['AD_FOO=x']),
    keyMatch: /AD_FOO/,
  },
  {
    name: 'buildReplayVarScope.fileEnv',
    run: () => buildReplayVarScope({ fileEnv: { AD_FOO: 'x' } }),
    keyMatch: /AD_FOO/,
  },
  {
    name: 'buildReplayVarScope.cliEnv',
    run: () => buildReplayVarScope({ cliEnv: { AD_SESSION: 'x' } }),
    keyMatch: /AD_SESSION/,
  },
])('rejects AD_* as reserved namespace in $name', ({ run, keyMatch }) => {
  assert.throws(
    run,
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /AD_\* namespace is reserved/.test(error.message) &&
      keyMatch.test(error.message),
  );
});

test('parseReplayCliEnvEntries error wording is user-friendly for invalid keys', () => {
  assert.throws(
    () => parseReplayCliEnvEntries(['lower=x']),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /uppercase letters, digits, and underscores/.test(error.message),
  );
});

test('buildReplayVarScope allows AD_* keys from builtins (trusted)', () => {
  const scope = buildReplayVarScope({
    builtins: { AD_SESSION: 's', AD_PLATFORM: 'android' },
  });
  assert.equal(scope.values.AD_SESSION, 's');
  assert.equal(scope.values.AD_PLATFORM, 'android');
});

test('runReplayScriptFile rejects replay -u when any action contains ${VAR}', async () => {
  const { response } = await runReplayFixture({
    label: 'var-heal',
    // No env directive, but positional uses ${APP}.
    script: 'context platform=android\nopen ${APP}\n',
    flags: { replayUpdate: true, replayEnv: ['APP=settings'] },
  });
  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(
      response.error.message,
      /replay -u does not yet preserve \$\{VAR\} substitutions/,
    );
  }
});

test('runReplayScriptFile dispatches resolved literals with file env overridden by CLI', async () => {
  const { response, calls } = await runReplayFixture({
    label: 'green',
    script:
      [
        'context platform=android',
        'env APP=file-app',
        'env SCOPE=file-scope',
        '',
        'open ${APP}',
        'snapshot -s ${SCOPE}',
        'click "at ${AD_FILENAME}"',
      ].join('\n') + '\n',
    flags: { replayEnv: ['APP=cli-app'] },
  });
  assert.equal(response.ok, true);
  // open ${APP} -> CLI override wins.
  assert.equal(calls[0]?.command, 'open');
  assert.deepEqual(calls[0]?.positionals, ['cli-app']);
  // snapshot -s ${SCOPE} -> file env fills in.
  assert.equal(calls[1]?.command, 'snapshot');
  assert.equal(calls[1]?.flags?.snapshotScope, 'file-scope');
  // click with ${AD_FILENAME} resolves to the relative script path.
  assert.equal(calls[2]?.command, 'click');
  assert.deepEqual(calls[2]?.positionals, ['at flow.ad']);
  // And nothing dispatched still contains a literal ${...} token.
  for (const call of calls) {
    for (const pos of call.positionals ?? []) {
      assert.equal(pos.includes('${'), false, `unresolved interpolation leaked: ${pos}`);
    }
  }
});

test('runReplayScriptFile reads shell env from request (client-collected), not daemon process.env', async () => {
  // Ensure the daemon's own process.env does NOT contain AD_VAR_APP.
  assert.equal(process.env.AD_VAR_APP, undefined);
  const { response, calls } = await runReplayFixture({
    label: 'shell',
    script: 'context platform=android\nopen ${APP}\n',
    // Client-collected shell env; still uses the raw AD_VAR_* prefix.
    flags: { replayShellEnv: { AD_VAR_APP: 'client-shell-app' } },
  });
  assert.equal(response.ok, true);
  assert.deepEqual(calls[0]?.positionals, ['client-shell-app']);
});

test('runReplayScriptFile falls back to process.env when request omits replayShellEnv', async () => {
  const previous = process.env.AD_VAR_APP;
  process.env.AD_VAR_APP = 'daemon-env-app';
  try {
    const { response, calls } = await runReplayFixture({
      label: 'shell-fallback',
      script: 'context platform=android\nopen ${APP}\n',
    });
    assert.equal(response.ok, true);
    assert.deepEqual(calls[0]?.positionals, ['daemon-env-app']);
  } finally {
    if (previous === undefined) delete process.env.AD_VAR_APP;
    else process.env.AD_VAR_APP = previous;
  }
});

test('AD_ARTIFACTS resolves to per-attempt dir when artifactsDir flag is set by the test runner', async () => {
  const attemptDir = '/tmp/agent-device-replay-artifacts-stub/run-x/flow/attempt-1';
  const { response, calls } = await runReplayFixture({
    label: 'artifacts',
    script: 'context platform=android\nscreenshot "${AD_ARTIFACTS}/shot.png"\n',
    flags: { artifactsDir: attemptDir },
  });
  assert.equal(response.ok, true);
  assert.deepEqual(calls[0]?.positionals, [`${attemptDir}/shot.png`]);
});
