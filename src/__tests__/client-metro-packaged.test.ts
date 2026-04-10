import { test } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'test', 'scripts', 'metro-prepare-packaged-smoke.mjs');

test(
  'packaged metro prepare auto-starts the companion and registers before bridge success',
  { timeout: 60_000 },
  () => {
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 120_000,
    });
    if (result.error) {
      throw result.error;
    }
    assert.equal(
      result.status,
      0,
      `packaged metro smoke script failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  },
);
