#!/usr/bin/env node
/**
 * Clear HarmonyOS app data/cache before a test run (resets privacy consent, login state, etc.).
 *
 * Usage:
 *   TRAVERSE_DEVICE=<hdc-serial> node scripts/clear-harmony-app-storage.mjs <bundle>
 *
 * Env:
 *   TRAVERSE_CLEAR_APP_DATA=0  skip data wipe (cache only)
 *   TRAVERSE_CLEAR_APP_CACHE=0 skip cache wipe (data only)
 */
import { spawnSync } from 'child_process';

const bundle = process.argv[2]?.trim();
const device = (process.env.TRAVERSE_DEVICE || process.env.TRAVERSE_HDC_TARGET || '').trim();
const clearData = process.env.TRAVERSE_CLEAR_APP_DATA !== '0';
const clearCache = process.env.TRAVERSE_CLEAR_APP_CACHE !== '0';

if (!bundle || !device) {
  console.error('用法: TRAVERSE_DEVICE=<serial> node scripts/clear-harmony-app-storage.mjs <bundle>');
  process.exit(1);
}

function hdc(args) {
  return spawnSync('hdc', ['-t', device, 'shell', ...args], { encoding: 'utf8' });
}

console.log(`=== 清理 ${bundle} 存储 (data=${clearData}, cache=${clearCache}) ===`);
hdc(['aa', 'force-stop', bundle]);

if (clearData) {
  const data = hdc(['bm', 'clean', '-n', bundle, '-d']);
  if (data.status !== 0) {
    console.error(data.stdout || data.stderr || 'bm clean -d failed');
    process.exit(1);
  }
  console.log(data.stdout.trim() || 'clean bundle data files successfully.');
}

if (clearCache) {
  const cache = hdc(['bm', 'clean', '-n', bundle, '-c']);
  if (cache.status !== 0) {
    console.error(cache.stdout || cache.stderr || 'bm clean -c failed');
    process.exit(1);
  }
  console.log(cache.stdout.trim() || 'clean bundle cache files successfully.');
}

console.log('app storage cleared');
