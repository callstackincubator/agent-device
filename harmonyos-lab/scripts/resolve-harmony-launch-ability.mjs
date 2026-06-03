#!/usr/bin/env node
/**
 * Resolve HarmonyOS launchAbility for a bundle via `agent-device apps --json`.
 * Prints ability name to stdout; exits 0 with empty output when unknown.
 *
 * Usage:
 *   TRAVERSE_DEVICE=<hdc-serial> node scripts/resolve-harmony-launch-ability.mjs <bundle>
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const bundle = process.argv[2]?.trim();
const device = (process.env.TRAVERSE_DEVICE || process.env.TRAVERSE_HDC_TARGET || '').trim();

if (!bundle || !device) {
  process.exit(0);
}

const cliCandidates = [
  path.join(ROOT, 'dist/src/cli.js'),
  path.join(ROOT, 'bin/agent-device.mjs'),
];
const cli = cliCandidates.find((candidate) => fs.existsSync(candidate));
if (!cli) {
  process.exit(0);
}

const result = spawnSync(
  'node',
  [cli, 'apps', '--platform', 'harmonyos', '--device', device, '--json'],
  { cwd: ROOT, encoding: 'utf8' },
);

let payload;
try {
  payload = JSON.parse(result.stdout || '{}');
} catch {
  process.exit(0);
}

const apps = payload?.data?.apps;
if (!Array.isArray(apps)) {
  process.exit(0);
}

const row = apps.find(
  (entry) => entry && typeof entry === 'object' && entry.bundleId === bundle,
);
if (row?.launchAbility) {
  process.stdout.write(String(row.launchAbility));
}
