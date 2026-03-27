import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../cli.ts';
import type { DaemonRequest, DaemonResponse } from '../daemon-client.ts';

class ExitSignal extends Error {
  public readonly code: number;

  constructor(code: number) {
    super(`EXIT_${code}`);
    this.code = code;
  }
}

type RunResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  calls: Omit<DaemonRequest, 'token'>[];
};

async function runCliCapture(
  argv: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string | undefined>;
  },
): Promise<RunResult> {
  let stdout = '';
  let stderr = '';
  let code: number | null = null;
  const calls: Array<Omit<DaemonRequest, 'token'>> = [];

  const originalExit = process.exit;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const originalCwd = process.cwd();
  const previousEnv = new Map<string, string | undefined>();

  if (options?.cwd) {
    process.chdir(options.cwd);
  }
  for (const [key, value] of Object.entries(options?.env ?? {})) {
    previousEnv.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  (process as any).exit = ((nextCode?: number) => {
    throw new ExitSignal(nextCode ?? 0);
  }) as typeof process.exit;
  (process.stdout as any).write = ((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  (process.stderr as any).write = ((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  const sendToDaemon = async (req: Omit<DaemonRequest, 'token'>): Promise<DaemonResponse> => {
    calls.push(req);
    return { ok: true, data: {} };
  };

  try {
    await runCli(argv, { sendToDaemon });
  } catch (error) {
    if (error instanceof ExitSignal) code = error.code;
    else throw error;
  } finally {
    process.exit = originalExit;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.chdir(originalCwd);
    for (const [key, value] of previousEnv.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  return { code, stdout, stderr, calls };
}

function makeTempWorkspace(): { root: string; home: string; project: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-config-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  return { root, home, project };
}

test('CLI merges config defaults with precedence user < project < env < CLI', async () => {
  const { root, home, project } = makeTempWorkspace();
  fs.mkdirSync(path.join(home, '.agent-device'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.agent-device', 'config.json'),
    JSON.stringify({ platform: 'ios', session: 'home-session', snapshotDepth: 2 }),
    'utf8',
  );
  fs.writeFileSync(
    path.join(project, 'agent-device.json'),
    JSON.stringify({ session: 'project-session', snapshotDepth: 4 }),
    'utf8',
  );

  const result = await runCliCapture(['snapshot', '--depth', '6', '--json'], {
    cwd: project,
    env: {
      HOME: home,
      AGENT_DEVICE_PLATFORM: 'android',
      AGENT_DEVICE_SNAPSHOT_DEPTH: '5',
    },
  });

  assert.equal(result.code, null);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0]?.session, 'project-session');
  assert.equal(result.calls[0]?.flags?.platform, 'android');
  assert.equal(result.calls[0]?.flags?.snapshotDepth, 6);

  fs.rmSync(root, { recursive: true, force: true });
});

test('config and env can set appsFilter through canonical enum values', async () => {
  const { root, home, project } = makeTempWorkspace();
  fs.mkdirSync(path.join(home, '.agent-device'), { recursive: true });
  fs.writeFileSync(
    path.join(project, 'agent-device.json'),
    JSON.stringify({ appsFilter: 'user-installed' }),
    'utf8',
  );

  const result = await runCliCapture(['apps', '--json'], {
    cwd: project,
    env: { HOME: home, AGENT_DEVICE_APPS_FILTER: 'all' },
  });

  assert.equal(result.code, null);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0]?.flags?.appsFilter, 'all');

  fs.rmSync(root, { recursive: true, force: true });
});

test('command-specific config defaults are ignored for commands that do not support them', async () => {
  const { root, home, project } = makeTempWorkspace();
  fs.mkdirSync(path.join(home, '.agent-device'), { recursive: true });
  fs.writeFileSync(
    path.join(project, 'agent-device.json'),
    JSON.stringify({ snapshotDepth: 4, platform: 'ios' }),
    'utf8',
  );

  const result = await runCliCapture(['open', 'settings', '--json'], {
    cwd: project,
    env: { HOME: home },
  });

  assert.equal(result.code, null);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0]?.flags?.platform, 'ios');
  assert.equal(Object.hasOwn(result.calls[0]?.flags ?? {}, 'snapshotDepth'), false);

  fs.rmSync(root, { recursive: true, force: true });
});

test('explicit --config path overrides default config discovery', async () => {
  const { root, home, project } = makeTempWorkspace();
  fs.mkdirSync(path.join(home, '.agent-device'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.agent-device', 'config.json'),
    JSON.stringify({ session: 'home-session' }),
    'utf8',
  );
  fs.writeFileSync(
    path.join(project, 'agent-device.json'),
    JSON.stringify({ session: 'project-session' }),
    'utf8',
  );
  const explicitConfig = path.join(root, 'custom-device-config.json');
  fs.writeFileSync(
    explicitConfig,
    JSON.stringify({ session: 'explicit-session', platform: 'apple' }),
    'utf8',
  );

  const result = await runCliCapture(['devices', '--config', explicitConfig, '--json'], {
    cwd: project,
    env: { HOME: home },
  });

  assert.equal(result.code, null);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0]?.session, 'explicit-session');
  assert.equal(result.calls[0]?.flags?.platform, 'apple');

  fs.rmSync(root, { recursive: true, force: true });
});

test('AGENT_DEVICE_CONFIG loads an explicit config path', async () => {
  const { root, home, project } = makeTempWorkspace();
  fs.mkdirSync(path.join(home, '.agent-device'), { recursive: true });
  const explicitConfig = path.join(home, 'env-config.json');
  fs.writeFileSync(
    explicitConfig,
    JSON.stringify({ session: 'env-explicit-session', platform: 'android' }),
    'utf8',
  );

  const result = await runCliCapture(['devices', '--json'], {
    cwd: project,
    env: { HOME: home, AGENT_DEVICE_CONFIG: '~/env-config.json' },
  });

  assert.equal(result.code, null);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0]?.session, 'env-explicit-session');
  assert.equal(result.calls[0]?.flags?.platform, 'android');

  fs.rmSync(root, { recursive: true, force: true });
});

test('remote config defaults override generic config and env for remote workflow bindings', async () => {
  const { root, home, project } = makeTempWorkspace();
  fs.mkdirSync(path.join(home, '.agent-device'), { recursive: true });
  fs.writeFileSync(
    path.join(project, 'agent-device.json'),
    JSON.stringify({ session: 'project-session', platform: 'ios' }),
    'utf8',
  );
  const remoteConfig = path.join(project, 'agent-device.remote.json');
  fs.writeFileSync(
    remoteConfig,
    JSON.stringify({
      session: 'remote-session',
      platform: 'android',
      daemonBaseUrl: 'http://remote-mac.example.test:9124/agent-device',
    }),
    'utf8',
  );

  const result = await runCliCapture(['snapshot', '--remote-config', remoteConfig, '--json'], {
    cwd: project,
    env: {
      HOME: home,
      AGENT_DEVICE_SESSION: 'env-session',
      AGENT_DEVICE_PLATFORM: 'ios',
    },
  });

  assert.equal(result.code, null);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0]?.session, 'remote-session');
  assert.equal(result.calls[0]?.flags?.platform, 'android');
  assert.equal(
    result.calls[0]?.flags?.daemonBaseUrl,
    'http://remote-mac.example.test:9124/agent-device',
  );

  fs.rmSync(root, { recursive: true, force: true });
});

test('missing explicit remote config path returns parse error before daemon dispatch', async () => {
  const { root, home, project } = makeTempWorkspace();

  const result = await runCliCapture(['snapshot', '--remote-config', './missing.remote.json'], {
    cwd: project,
    env: { HOME: home },
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Remote config file not found/);
  assert.equal(result.calls.length, 0);

  fs.rmSync(root, { recursive: true, force: true });
});

test('config and env defaults include session lock policy flags', async () => {
  const { root, home, project } = makeTempWorkspace();
  fs.mkdirSync(path.join(home, '.agent-device'), { recursive: true });
  fs.writeFileSync(
    path.join(project, 'agent-device.json'),
    JSON.stringify({ sessionLock: 'reject' }),
    'utf8',
  );

  const result = await runCliCapture(['snapshot', '--json'], {
    cwd: project,
    env: { HOME: home, AGENT_DEVICE_SESSION_LOCK: 'strip' },
  });

  assert.equal(result.code, null);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0]?.meta?.lockPolicy, 'strip');
  assert.equal(Object.hasOwn(result.calls[0]?.flags ?? {}, 'sessionLock'), false);

  fs.rmSync(root, { recursive: true, force: true });
});

test('config defaults drive bound-session metadata without env-only fallbacks', async () => {
  const { root, home, project } = makeTempWorkspace();
  fs.writeFileSync(
    path.join(project, 'agent-device.json'),
    JSON.stringify({ session: 'qa-ios', platform: 'ios', sessionLock: 'reject' }),
    'utf8',
  );

  const result = await runCliCapture(['snapshot', '--json'], {
    cwd: project,
    env: { HOME: home },
  });

  assert.equal(result.code, null);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0]?.session, 'qa-ios');
  assert.equal(result.calls[0]?.flags?.platform, 'ios');
  assert.equal(result.calls[0]?.meta?.lockPolicy, 'reject');
  assert.equal(result.calls[0]?.meta?.lockPlatform, 'ios');

  fs.rmSync(root, { recursive: true, force: true });
});

test('missing explicit config path returns parse error before daemon dispatch', async () => {
  const { root, home, project } = makeTempWorkspace();

  const result = await runCliCapture(['devices', '--config', './missing.json'], {
    cwd: project,
    env: { HOME: home },
  });

  assert.equal(result.code, 1);
  assert.equal(result.calls.length, 0);
  assert.match(result.stderr, /Config file not found/);

  fs.rmSync(root, { recursive: true, force: true });
});

test('invalid config key returns parse error before daemon dispatch', async () => {
  const { root, home, project } = makeTempWorkspace();
  fs.writeFileSync(
    path.join(project, 'agent-device.json'),
    JSON.stringify({ notARealFlag: true }),
    'utf8',
  );

  const result = await runCliCapture(['devices'], {
    cwd: project,
    env: { HOME: home },
  });

  assert.equal(result.code, 1);
  assert.equal(result.calls.length, 0);
  assert.match(result.stderr, /Unknown config key "notARealFlag"/);

  fs.rmSync(root, { recursive: true, force: true });
});
