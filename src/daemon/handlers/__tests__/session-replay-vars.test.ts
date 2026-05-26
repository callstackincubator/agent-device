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
} from '../../../replay/vars.ts';
import {
  parseReplayScript,
  parseReplayScriptDetailed,
  readReplayScriptMetadata,
} from '../../../replay/script.ts';
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
  files?: Record<string, string>;
  flags?: CommandFlags;
  invoke?: (req: DaemonRequest) => Promise<DaemonResponse>;
}): Promise<{
  response: DaemonResponse;
  calls: CapturedInvocation[];
  root: string;
  scriptPath: string;
}> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `agent-device-replay-${params.label}-`));
  for (const [name, contents] of Object.entries(params.files ?? {})) {
    fs.writeFileSync(path.join(root, name), contents);
  }
  const scriptPath = path.join(root, 'flow.ad');
  fs.writeFileSync(scriptPath, params.script);
  const calls: CapturedInvocation[] = [];
  const invoke = async (req: DaemonRequest): Promise<DaemonResponse> => {
    calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
    if (params.invoke) return await params.invoke(req);
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
    invoke,
  });
  return { response, calls, root, scriptPath };
}

test('resolveReplayString substitutes variables', () => {
  const scope = buildReplayVarScope({ fileEnv: { APP: 'settings' } });
  assert.equal(resolveReplayString('open ${APP}', scope, LOC), 'open settings');
});

test('resolveReplayString supports fallback with :-default', () => {
  const scope = buildReplayVarScope({});
  assert.equal(resolveReplayString('wait ${WAIT_SHORT:-500}', scope, LOC), 'wait 500');
});

test('resolveReplayString prefers scope value over fallback', () => {
  const scope = buildReplayVarScope({ fileEnv: { WAIT_SHORT: '1000' } });
  assert.equal(resolveReplayString('wait ${WAIT_SHORT:-500}', scope, LOC), 'wait 1000');
});

test('resolveReplayString fallback preserves embedded braces via escapes', () => {
  const scope = buildReplayVarScope({});
  assert.equal(resolveReplayString('x ${A:-one\\}two}', scope, LOC), 'x one}two');
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
  assert.deepEqual(parseReplayCliEnvEntries(['APP=settings', 'FOO=bar=baz']), {
    APP: 'settings',
    FOO: 'bar=baz',
  });
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
  const metadata = readReplayScriptMetadata(
    'env APP=settings\ncontext platform=ios target=mobile\n',
  );
  assert.equal(metadata.platform, 'ios');
  assert.equal(metadata.target, 'mobile');
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
    () => readReplayScriptMetadata('context platform=android\nenv lower=settings\n'),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /Invalid env key "lower"/.test(error.message),
  );
});

test('readReplayScriptMetadata rejects duplicate env key', () => {
  assert.throws(
    () => readReplayScriptMetadata('context platform=android\nenv APP=a\nenv APP=b\n'),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /Duplicate env directive "APP"/.test(error.message),
  );
});

test('parseReplayScript rejects env after first action', () => {
  assert.throws(
    () => parseReplayScript('context platform=android\nopen settings\nenv APP=late\n'),
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

// fallow-ignore-next-line complexity
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

test('runReplayScriptFile applies CLI env overrides before Maestro compat mapping', async () => {
  const { response, calls } = await runReplayFixture({
    label: 'maestro-env',
    script: [
      'appId: ${APP_ID}',
      'env:',
      '  APP_ID: yaml-app',
      '  BUTTON_ID: yaml-button',
      '---',
      '- launchApp',
      '- tapOn:',
      '    id: ${BUTTON_ID}',
      '',
    ].join('\n'),
    flags: {
      replayBackend: 'maestro',
      replayShellEnv: { AD_VAR_BUTTON_ID: 'shell-button' },
      replayEnv: ['APP_ID=cli-app'],
    },
    invoke: async (req) => {
      if (req.command === 'snapshot') {
        return {
          ok: true,
          data: {
            nodes: [
              {
                index: 1,
                identifier: 'shell-button',
                rect: { x: 20, y: 40, width: 120, height: 44 },
              },
            ],
          },
        };
      }
      return { ok: true, data: {} };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(calls[0]?.positionals, ['cli-app']);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [
      ['open', ['cli-app']],
      ['snapshot', []],
      ['click', ['80', '62']],
    ],
  );
});

test('runReplayScriptFile runs Maestro runScript in replay order and exposes output variables', async () => {
  const { response, calls } = await runReplayFixture({
    label: 'maestro-runscript-runtime',
    files: {
      'setup.js': `
var res = {body: '{"appviewDid":"did:plc:test"}'}
output.result = SERVER_PATH + ':' + json(res.body).appviewDid
`,
    },
    script: [
      'appId: demo.app',
      '---',
      '- runScript:',
      '    file: ./setup.js',
      '    env:',
      '      SERVER_PATH: local',
      '- inputText: ${output.result}',
      '',
    ].join('\n'),
    flags: { replayBackend: 'maestro' },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [['type', ['local:did:plc:test']]],
  );
});

test('runReplayScriptFile reports Maestro runScript failures at the runScript step', async () => {
  const { response, calls } = await runReplayFixture({
    label: 'maestro-runscript-fail',
    files: {
      'setup.js': `output.result = http.post('http://127.0.0.1:1').body`,
    },
    script: ['appId: demo.app', '---', '- runScript: ./setup.js', '- inputText: never', ''].join(
      '\n',
    ),
    flags: { replayBackend: 'maestro' },
  });

  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.match(response.error.message, /Replay failed at step 1/);
    assert.match(response.error.message, /runScript failed/);
    assert.match(response.error.message, /http\.post failed/);
  }
  assert.equal(calls.length, 0);
});

test('runReplayScriptFile rejects Maestro runScript output keys containing dots', async () => {
  const { response, calls } = await runReplayFixture({
    label: 'maestro-runscript-dotted-output',
    files: {
      'setup.js': `output['nested.value'] = 'ambiguous'`,
    },
    script: ['appId: demo.app', '---', '- runScript: ./setup.js', '- inputText: never', ''].join(
      '\n',
    ),
    flags: { replayBackend: 'maestro' },
  });

  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.match(response.error.message, /Replay failed at step 1/);
    assert.match(response.error.message, /output key cannot contain/);
  }
  assert.equal(calls.length, 0);
});

test('runReplayScriptFile retries Maestro scrollUntilVisible with scroll probes', async () => {
  const calls: CapturedInvocation[] = [];
  let waitAttempts = 0;
  const { response } = await runReplayFixture({
    label: 'maestro-scroll-until-visible',
    script: [
      'appId: demo.app',
      '---',
      '- scrollUntilVisible:',
      '    element: Discover',
      '    direction: UP',
      '    timeout: 1200',
      '',
    ].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      if (req.command === 'scroll') return { ok: true, data: {} };
      if (req.command === 'find') {
        return {
          ok: false,
          error: { code: 'COMMAND_FAILED', message: 'find wait timed out' },
        };
      }
      waitAttempts += 1;
      if (waitAttempts === 3) return { ok: true, data: { waitedMs: 1100 } };
      return {
        ok: false,
        error: { code: 'COMMAND_FAILED', message: 'wait timed out' },
      };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [
      ['wait', ['label="Discover" || text="Discover" || id="Discover"', '500']],
      ['find', ['Discover', 'wait', '500']],
      ['scroll', ['up']],
      ['wait', ['label="Discover" || text="Discover" || id="Discover"', '500']],
      ['find', ['Discover', 'wait', '500']],
      ['scroll', ['up']],
      ['wait', ['label="Discover" || text="Discover" || id="Discover"', '200']],
    ],
  );
});

test('runReplayScriptFile lets Maestro scrollUntilVisible use fuzzy visible text matching', async () => {
  const calls: CapturedInvocation[] = [];
  const { response } = await runReplayFixture({
    label: 'maestro-scroll-until-visible-fuzzy-text',
    script: ['appId: demo.app', '---', '- scrollUntilVisible:', '    element: Discover', ''].join(
      '\n',
    ),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      if (req.command === 'find') return { ok: true, data: { found: true } };
      return {
        ok: false,
        error: { code: 'COMMAND_FAILED', message: 'wait timed out' },
      };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [
      ['wait', ['label="Discover" || text="Discover" || id="Discover"', '500']],
      ['find', ['Discover', 'wait', '500']],
    ],
  );
});

test('runReplayScriptFile lets Maestro tapOn use fuzzy visible text matching', async () => {
  const calls: CapturedInvocation[] = [];
  const { response } = await runReplayFixture({
    label: 'maestro-tap-visible-text-fuzzy',
    script: ['appId: demo.app', '---', '- tapOn: Discover', ''].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      if (req.command === 'find') return { ok: true, data: { found: true } };
      return {
        ok: false,
        error: { code: 'COMMAND_FAILED', message: 'Selector did not match' },
      };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [
      ['snapshot', []],
      ['find', ['Discover', 'click']],
    ],
  );
  assert.equal(calls[0]?.flags?.noRecord, true);
  assert.equal(calls[1]?.flags?.findFirst, true);
});

test('runReplayScriptFile lets exact Maestro text tapOn win before fuzzy matching', async () => {
  const calls: CapturedInvocation[] = [];
  const { response } = await runReplayFixture({
    label: 'maestro-tap-visible-text-exact-before-fuzzy',
    script: ['appId: demo.app', '---', '- tapOn: Mute accounts', ''].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      if (req.command === 'snapshot') {
        return {
          ok: true,
          data: {
            nodes: [
              {
                index: 1,
                label: 'Block accounts',
                rect: { x: 10, y: 600, width: 240, height: 44 },
              },
              {
                index: 2,
                label: 'Mute accounts',
                rect: { x: 10, y: 540, width: 240, height: 44 },
              },
            ],
          },
        };
      }
      return { ok: true, data: {} };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [
      ['snapshot', []],
      ['click', ['130', '562']],
    ],
  );
});

test('runReplayScriptFile prefers on-screen Maestro text tapOn matches', async () => {
  const calls: CapturedInvocation[] = [];
  const { response } = await runReplayFixture({
    label: 'maestro-tap-visible-text-onscreen',
    script: ['appId: demo.app', '---', '- tapOn: Sign in', ''].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      if (req.command === 'snapshot') {
        return {
          ok: true,
          data: {
            nodes: [
              {
                index: 1,
                type: 'Button',
                label: 'Sign in',
                rect: { x: -328, y: 182, width: 328, height: 42 },
              },
              {
                index: 2,
                type: 'Button',
                label: 'Sign in',
                rect: { x: 56, y: 842, width: 328, height: 56 },
              },
            ],
            metadata: { referenceWidth: 440, referenceHeight: 956 },
          },
        };
      }
      return { ok: true, data: {} };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [
      ['snapshot', []],
      ['click', ['220', '870']],
    ],
  );
});

test('runReplayScriptFile taps Maestro text near the label in large action containers', async () => {
  const calls: CapturedInvocation[] = [];
  const { response } = await runReplayFixture({
    label: 'maestro-tap-visible-text-action-container',
    script: ['appId: demo.app', '---', '- tapOn: Mute accounts', ''].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      if (req.command === 'snapshot') {
        return {
          ok: true,
          data: {
            nodes: [
              {
                index: 1,
                type: 'ScrollView',
                label: 'Mute accounts',
                rect: { x: 8, y: 805, width: 424, height: 93 },
              },
              {
                index: 2,
                parentIndex: 1,
                type: 'Other',
                label: 'Block accounts',
                rect: { x: 31, y: 835, width: 377, height: 42 },
              },
            ],
          },
        };
      }
      return { ok: true, data: {} };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [
      ['snapshot', []],
      ['click', ['92', '829']],
    ],
  );
});

test('runReplayScriptFile prefers actionable Maestro tapOn matches over broad ancestors', async () => {
  const calls: CapturedInvocation[] = [];
  const { response } = await runReplayFixture({
    label: 'maestro-tap-prefers-actionable-match',
    script: ['appId: demo.app', '---', '- tapOn: New list', ''].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      if (req.command === 'snapshot') {
        return {
          ok: true,
          data: {
            nodes: [
              {
                index: 1,
                type: 'Other',
                label: 'New list',
                rect: { x: 0, y: 0, width: 440, height: 956 },
              },
              {
                index: 2,
                type: 'Button',
                label: 'New list',
                rect: { x: 349, y: 67, width: 75, height: 33 },
              },
            ],
          },
        };
      }
      return { ok: true, data: {} };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [
      ['snapshot', []],
      ['click', ['387', '84']],
    ],
  );
});

test('runReplayScriptFile treats absent Maestro assertNotVisible targets as passing', async () => {
  const calls: CapturedInvocation[] = [];
  const { response } = await runReplayFixture({
    label: 'maestro-assert-not-visible-absent',
    script: ['appId: demo.app', '---', '- assertNotVisible: Feeds ✨', ''].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      return {
        ok: false,
        error: { code: 'ELEMENT_NOT_FOUND', message: 'Selector did not match' },
      };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [['is', ['visible', 'label="Feeds ✨" || text="Feeds ✨" || id="Feeds ✨"']]],
  );
  assert.equal(calls[0]?.flags?.noRecord, true);
});

test('runReplayScriptFile retries Maestro fuzzy tapOn without raw selector fallback', async () => {
  const calls: CapturedInvocation[] = [];
  let findAttempts = 0;
  const { response } = await runReplayFixture({
    label: 'maestro-tap-visible-text-fuzzy-retry',
    script: ['appId: demo.app', '---', '- tapOn: Discover', ''].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      if (req.command === 'find') {
        findAttempts += 1;
        if (findAttempts === 2) return { ok: true, data: { found: true } };
      }
      return {
        ok: false,
        error: { code: 'ELEMENT_NOT_FOUND', message: 'element not found' },
      };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [
      ['snapshot', []],
      ['find', ['Discover', 'click']],
      ['snapshot', []],
      ['find', ['Discover', 'click']],
    ],
  );
});

test('runReplayScriptFile lets optional Maestro fuzzy tapOn click first visible match', async () => {
  const calls: CapturedInvocation[] = [];
  const { response } = await runReplayFixture({
    label: 'maestro-tap-visible-text-optional-first-match',
    script: [
      'appId: demo.app',
      '---',
      '- tapOn:',
      '    text: Later',
      '    optional: true',
      '',
    ].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      if (req.command === 'find' && req.flags?.findFirst === true) {
        return { ok: true, data: { ref: '@e4', x: 220, y: 720 } };
      }
      return {
        ok: false,
        error: { code: 'AMBIGUOUS_MATCH', message: 'matched multiple elements' },
      };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [
      ['snapshot', []],
      ['find', ['Later', 'click']],
    ],
  );
  assert.equal(calls[1]?.flags?.findFirst, true);
});

test('runReplayScriptFile resolves Maestro percentage point taps from snapshot size', async () => {
  const calls: CapturedInvocation[] = [];
  const { response } = await runReplayFixture({
    label: 'maestro-tap-point-percent',
    script: ['appId: demo.app', '---', '- tapOn:', '    point: 20%,20%', ''].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      if (req.command === 'snapshot') {
        return {
          ok: true,
          data: {
            nodes: [
              {
                index: 0,
                type: 'application',
                rect: { x: 0, y: 0, width: 1000, height: 2000 },
              },
            ],
          },
        };
      }
      return { ok: true, data: {} };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [
      ['snapshot', []],
      ['click', ['200', '400']],
    ],
  );
  assert.equal(calls[0]?.flags?.noRecord, true);
});

test('runReplayScriptFile retries Maestro id tapOn through snapshot coordinates', async () => {
  const calls: CapturedInvocation[] = [];
  let snapshotAttempts = 0;
  const { response } = await runReplayFixture({
    label: 'maestro-tap-on-retry',
    script: ['appId: demo.app', '---', '- tapOn:', '    id: delayedButton', ''].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      if (req.command === 'snapshot') {
        snapshotAttempts += 1;
        if (snapshotAttempts === 3) {
          return {
            ok: true,
            data: {
              nodes: [
                {
                  index: 1,
                  identifier: 'delayedButton',
                  rect: { x: 20, y: 40, width: 120, height: 44 },
                },
              ],
            },
          };
        }
        return {
          ok: false,
          error: { code: 'ELEMENT_NOT_FOUND', message: 'element not found' },
        };
      }
      if (req.command === 'click') return { ok: true, data: {} };
      return {
        ok: false,
        error: { code: 'ELEMENT_NOT_FOUND', message: 'element not found' },
      };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [
      ['snapshot', []],
      ['snapshot', []],
      ['snapshot', []],
      ['click', ['80', '62']],
    ],
  );
});

test('runReplayScriptFile resolves Maestro tapOn index and childOf from snapshots', async () => {
  const calls: CapturedInvocation[] = [];
  const { response } = await runReplayFixture({
    label: 'maestro-tap-index-childof',
    script: [
      'appId: demo.app',
      '---',
      '- tapOn:',
      '    id: likeBtn',
      '    childOf:',
      '      id: postThreadItem-by-bob.test',
      '- tapOn:',
      '    id: postDropdownBtn',
      '    index: 1',
      '',
    ].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      if (req.command === 'snapshot') {
        return {
          ok: true,
          data: {
            nodes: [
              { index: 1, identifier: 'postThreadItem-by-alice.test' },
              {
                index: 2,
                parentIndex: 1,
                identifier: 'likeBtn',
                rect: { x: 10, y: 10, width: 40, height: 20 },
              },
              { index: 10, identifier: 'postThreadItem-by-bob.test' },
              {
                index: 11,
                parentIndex: 10,
                identifier: 'likeBtn',
                rect: { x: 20, y: 120, width: 40, height: 20 },
              },
              {
                index: 20,
                identifier: 'postDropdownBtn',
                rect: { x: 100, y: 200, width: 40, height: 20 },
              },
              {
                index: 21,
                identifier: 'postDropdownBtn',
                rect: { x: 200, y: 300, width: 40, height: 20 },
              },
            ],
          },
        };
      }
      return { ok: true, data: {} };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [
      ['snapshot', []],
      ['click', ['40', '130']],
      ['snapshot', []],
      ['click', ['220', '310']],
    ],
  );
  assert.equal(calls[0]?.flags?.noRecord, true);
});

test('runReplayScriptFile lets snapshot id tap handle Maestro one-point edge controls', async () => {
  const calls: CapturedInvocation[] = [];
  const { response } = await runReplayFixture({
    label: 'maestro-tap-edge-rect',
    script: ['appId: demo.app', '---', '- tapOn:', '    id: e2eSignInAlice', ''].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      if (req.command === 'snapshot') {
        return {
          ok: true,
          data: {
            nodes: [
              {
                index: 1,
                identifier: 'e2eSignInAlice',
                rect: { x: 0, y: 0, width: 1, height: 1 },
              },
            ],
          },
        };
      }
      return { ok: true, data: {} };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [
      ['snapshot', []],
      ['click', ['0', '0']],
    ],
  );
});

test('runReplayScriptFile keeps Maestro text-entry tapOn on the snapshot path', async () => {
  const calls: CapturedInvocation[] = [];
  const { response } = await runReplayFixture({
    label: 'maestro-tap-input-text-snapshot',
    script: [
      'appId: demo.app',
      '---',
      '- tapOn:',
      '    id: editListNameInput',
      '- inputText: Muted Users',
      '',
    ].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      if (req.command === 'snapshot') {
        return {
          ok: true,
          data: {
            nodes: [
              {
                index: 1,
                identifier: 'editListNameInput',
                rect: { x: 20, y: 100, width: 200, height: 40 },
              },
            ],
          },
        };
      }
      return { ok: true, data: {} };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [
      ['snapshot', []],
      ['click', ['120', '120']],
      ['type', ['Muted Users']],
    ],
  );
  assert.equal(calls[0]?.flags?.noRecord, true);
});

test('runReplayScriptFile resolves Maestro swipe.label from a labeled element rect', async () => {
  const calls: CapturedInvocation[] = [];
  const { response } = await runReplayFixture({
    label: 'maestro-swipe-label',
    script: [
      'appId: demo.app',
      '---',
      '- swipe:',
      '    label: Thread body',
      '    direction: UP',
      '    duration: 400',
      '',
    ].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      if (req.command === 'snapshot') {
        return {
          ok: true,
          data: {
            nodes: [
              {
                index: 1,
                label: 'Thread body',
                rect: { x: 10, y: 100, width: 200, height: 300 },
              },
            ],
          },
        };
      }
      return { ok: true, data: {} };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [
      ['snapshot', []],
      ['swipe', ['110', '250', '110', '8', '400']],
    ],
  );
});

test('runReplayScriptFile maps Maestro enter to keyboard enter', async () => {
  const calls: CapturedInvocation[] = [];
  const { response } = await runReplayFixture({
    label: 'maestro-press-enter',
    script: ['appId: demo.app', '---', '- pressKey: Enter', ''].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      return { ok: true, data: {} };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [['keyboard', ['enter']]],
  );
});

test('runReplayScriptFile waits for Maestro animation snapshots to stabilize', async () => {
  const calls: CapturedInvocation[] = [];
  let snapshots = 0;
  const { response } = await runReplayFixture({
    label: 'maestro-wait-animation-stable',
    script: ['appId: demo.app', '---', '- waitForAnimationToEnd', ''].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      snapshots += 1;
      const y = snapshots === 1 ? 100 : 120;
      return {
        ok: true,
        data: {
          nodes: [
            {
              index: 1,
              label: 'Animating',
              rect: { x: 10, y, width: 100, height: 40 },
            },
          ],
        },
      };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [
      ['snapshot', []],
      ['snapshot', []],
      ['snapshot', []],
    ],
  );
  assert.equal(calls[0]?.flags?.noRecord, true);
});

test('runReplayScriptFile falls back to newline type when keyboard enter is unsupported', async () => {
  const calls: CapturedInvocation[] = [];
  const { response } = await runReplayFixture({
    label: 'maestro-press-enter-fallback',
    script: ['appId: demo.app', '---', '- pressKey: Enter', ''].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      if (req.command === 'keyboard') {
        return { ok: false, error: { code: 'UNSUPPORTED_OPERATION', message: 'unsupported' } };
      }
      return { ok: true, data: {} };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [
      ['keyboard', ['enter']],
      ['type', ['\n']],
    ],
  );
});

test('runReplayScriptFile skips Maestro runFlow.when.visible commands when absent', async () => {
  const calls: CapturedInvocation[] = [];
  const { response } = await runReplayFixture({
    label: 'maestro-run-flow-when-visible-skip',
    script: [
      'appId: demo.app',
      '---',
      '- runFlow:',
      '    when:',
      '      visible: Continue',
      '    commands:',
      '      - tapOn: Continue',
      '',
    ].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      return {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: 'not visible',
          details: { command: 'is', reason: 'selector_not_found' },
        },
      };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [['is', ['visible', 'label="Continue" || text="Continue" || id="Continue"']]],
  );
});

test('runReplayScriptFile skips Maestro runFlow.when.visible commands on false predicate', async () => {
  const calls: CapturedInvocation[] = [];
  const { response } = await runReplayFixture({
    label: 'maestro-run-flow-when-visible-false-skip',
    script: [
      'appId: demo.app',
      '---',
      '- runFlow:',
      '    when:',
      '      visible: Continue',
      '    commands:',
      '      - tapOn: Continue',
      '',
    ].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      return { ok: true, data: { pass: false } };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [['is', ['visible', 'label="Continue" || text="Continue" || id="Continue"']]],
  );
});

test('runReplayScriptFile propagates Maestro runFlow.when runtime errors', async () => {
  const { response } = await runReplayFixture({
    label: 'maestro-run-flow-when-visible-runtime-error',
    script: [
      'appId: demo.app',
      '---',
      '- runFlow:',
      '    when:',
      '      visible: Continue',
      '    commands:',
      '      - tapOn: Continue',
      '',
    ].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async () => ({
      ok: false,
      error: { code: 'UNKNOWN', message: 'fetch failed' },
    }),
  });

  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.equal(response.error.code, 'UNKNOWN');
    assert.match(response.error.message, /fetch failed/);
  }
});

test('runReplayScriptFile propagates Maestro runFlow.when COMMAND_FAILED errors without condition-miss details', async () => {
  const { response } = await runReplayFixture({
    label: 'maestro-run-flow-when-visible-command-error',
    script: [
      'appId: demo.app',
      '---',
      '- runFlow:',
      '    when:',
      '      visible: Continue',
      '    commands:',
      '      - tapOn: Continue',
      '',
    ].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async () => ({
      ok: false,
      error: { code: 'COMMAND_FAILED', message: 'snapshot failed' },
    }),
  });

  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.equal(response.error.code, 'COMMAND_FAILED');
    assert.match(response.error.message, /snapshot failed/);
  }
});

test('runReplayScriptFile runs Maestro runFlow.when.visible commands when present', async () => {
  const calls: CapturedInvocation[] = [];
  const { response } = await runReplayFixture({
    label: 'maestro-run-flow-when-visible-run',
    script: [
      'appId: demo.app',
      '---',
      '- runFlow:',
      '    when:',
      '      visible: Continue',
      '    commands:',
      '      - tapOn: Continue',
      '',
    ].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      if (req.command === 'is') return { ok: true, data: { pass: true } };
      if (req.command === 'click') {
        return {
          ok: false,
          error: { code: 'COMMAND_FAILED', message: 'Selector did not match' },
        };
      }
      return { ok: true, data: {} };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [
      ['is', ['visible', 'label="Continue" || text="Continue" || id="Continue"']],
      ['snapshot', []],
      ['find', ['Continue', 'click']],
    ],
  );
});

test('runReplayScriptFile runs nested Maestro runtime commands inside runFlow.when', async () => {
  const calls: CapturedInvocation[] = [];
  const { response } = await runReplayFixture({
    label: 'maestro-run-flow-when-nested-runtime',
    script: [
      'appId: demo.app',
      '---',
      '- runFlow:',
      '    when:',
      '      visible: Feed',
      '    commands:',
      '      - scrollUntilVisible:',
      '          element: Done',
      '          direction: DOWN',
      '          timeout: 500',
      '',
    ].join('\n'),
    flags: { replayBackend: 'maestro' },
    invoke: async (req) => {
      calls.push({ command: req.command, positionals: req.positionals, flags: req.flags });
      if (req.command === 'is') return { ok: true, data: { pass: true } };
      if (req.command === 'wait') return { ok: true, data: { found: true } };
      return { ok: true, data: {} };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [
      ['is', ['visible', 'label="Feed" || text="Feed" || id="Feed"']],
      ['wait', ['label="Done" || text="Done" || id="Done"', '500']],
    ],
  );
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

test('runReplayScriptFile writes per-action timing events to active trace', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-trace-'));
  const scriptPath = path.join(root, 'flow.ad');
  const tracePath = path.join(root, 'trace.ndjson');
  fs.writeFileSync(scriptPath, 'context platform=ios\nclick id="submit"\nwait "Done" 5000\n');
  fs.writeFileSync(tracePath, '');

  const sessionStore = new SessionStore(path.join(root, 'state'));
  sessionStore.set('s', {
    name: 's',
    device: {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone',
      kind: 'simulator',
      booted: true,
    },
    createdAt: Date.now(),
    trace: { outPath: tracePath, startedAt: Date.now() },
    actions: [],
  });

  const response = await runReplayScriptFile({
    req: {
      token: 't',
      session: 's',
      command: 'replay',
      positionals: [scriptPath],
      flags: {},
      meta: { cwd: root },
    },
    sessionName: 's',
    logPath: path.join(root, 'log'),
    sessionStore,
    invoke: async () => ({ ok: true, data: {} }),
  });

  assert.equal(response.ok, true);
  const events = fs
    .readFileSync(tracePath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(
    events.map((event) => [event.type, event.step, event.command]),
    [
      ['replay_action_start', 1, 'click'],
      ['replay_action_stop', 1, 'click'],
      ['replay_action_start', 2, 'wait'],
      ['replay_action_stop', 2, 'wait'],
    ],
  );
  assert.equal(typeof events[1]?.durationMs, 'number');
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
