import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { maybeRunUpgradeNotifier, runUpdateCheckWorker } from '../utils/update-check.ts';

function makeTempStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-update-check-'));
}

function writeCache(stateDir: string, payload: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(stateDir, 'update-check.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
}

function readCache(stateDir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(stateDir, 'update-check.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

async function runNotifier(
  options: Parameters<typeof maybeRunUpgradeNotifier>[0],
  deps: Parameters<typeof maybeRunUpgradeNotifier>[1],
): Promise<void> {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCi = process.env.CI;
  const previousOptOut = process.env.AGENT_DEVICE_NO_UPDATE_NOTIFIER;

  delete process.env.NODE_ENV;
  delete process.env.CI;
  delete process.env.AGENT_DEVICE_NO_UPDATE_NOTIFIER;

  try {
    await maybeRunUpgradeNotifier(options, deps);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousCi === undefined) delete process.env.CI;
    else process.env.CI = previousCi;
    if (previousOptOut === undefined) delete process.env.AGENT_DEVICE_NO_UPDATE_NOTIFIER;
    else process.env.AGENT_DEVICE_NO_UPDATE_NOTIFIER = previousOptOut;
  }
}

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const next = cleanupPaths.pop();
    if (next) {
      fs.rmSync(next, { recursive: true, force: true });
    }
  }
});

test('notifier prints cached upgrade notice once for a newly discovered version', async () => {
  const stateDir = makeTempStateDir();
  cleanupPaths.push(stateDir);
  const now = Date.parse('2026-03-31T10:00:00.000Z');
  writeCache(stateDir, {
    latestVersion: '0.12.0',
    checkedAt: '2026-03-25T10:00:00.000Z',
  });

  let stderr = '';
  let spawnCalls = 0;

  await runNotifier(
    {
      command: 'devices',
      currentVersion: '0.11.3',
      stateDir,
      flags: {},
    },
    {
      now: () => now,
      isTTY: () => true,
      writeStderr: (message) => {
        stderr += message;
      },
      spawnBackgroundCheck: () => {
        spawnCalls += 1;
      },
    },
  );

  assert.match(stderr, /Update available: agent-device 0\.11\.3 -> 0\.12\.0/);
  assert.equal(spawnCalls, 0);
  const cache = readCache(stateDir);
  assert.equal(cache.promptVersion, '0.12.0');
  assert.equal(cache.promptAt, '2026-03-31T10:00:00.000Z');
});

test('notifier skips repeat prompts inside the cooldown window for the same version', async () => {
  const stateDir = makeTempStateDir();
  cleanupPaths.push(stateDir);
  writeCache(stateDir, {
    latestVersion: '0.12.0',
    checkedAt: '2026-03-25T10:00:00.000Z',
    promptAt: '2026-03-29T10:00:00.000Z',
    promptVersion: '0.12.0',
  });

  let stderr = '';

  await runNotifier(
    {
      command: 'devices',
      currentVersion: '0.11.3',
      stateDir,
      flags: {},
    },
    {
      now: () => Date.parse('2026-03-31T10:00:00.000Z'),
      isTTY: () => true,
      writeStderr: (message) => {
        stderr += message;
      },
      spawnBackgroundCheck: () => {
        assert.fail('background check should not run for a fresh cache');
      },
    },
  );

  assert.equal(stderr, '');
});

test('notifier starts a background check when the cache is stale', async () => {
  const stateDir = makeTempStateDir();
  cleanupPaths.push(stateDir);
  writeCache(stateDir, {
    checkedAt: '2026-03-01T10:00:00.000Z',
  });

  let spawnPayload: { cachePath: string; currentVersion: string } | undefined;

  await runNotifier(
    {
      command: 'devices',
      currentVersion: '0.11.3',
      stateDir,
      flags: {},
    },
    {
      now: () => Date.parse('2026-03-31T10:00:00.000Z'),
      isTTY: () => true,
      spawnBackgroundCheck: (cachePath, currentVersion) => {
        spawnPayload = { cachePath, currentVersion };
      },
    },
  );

  assert.deepEqual(spawnPayload, {
    cachePath: path.join(stateDir, 'update-check.json'),
    currentVersion: '0.11.3',
  });
});

test('worker resets prompt state when it discovers a newer version', async () => {
  const stateDir = makeTempStateDir();
  cleanupPaths.push(stateDir);
  const cachePath = path.join(stateDir, 'update-check.json');
  writeCache(stateDir, {
    latestVersion: '0.12.0',
    checkedAt: '2026-03-15T10:00:00.000Z',
    promptAt: '2026-03-20T10:00:00.000Z',
    promptVersion: '0.12.0',
  });

  await runUpdateCheckWorker({
    cachePath,
    currentVersion: '0.11.3',
    now: () => Date.parse('2026-03-31T10:00:00.000Z'),
    fetchLatestVersion: async () => '0.13.0',
  });

  const cache = readCache(stateDir);
  assert.equal(cache.latestVersion, '0.13.0');
  assert.equal(cache.promptVersion, undefined);
  assert.equal(cache.promptAt, undefined);
});
