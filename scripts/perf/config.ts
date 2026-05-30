import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Platform } from './types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
export const CLI_BIN = path.join(REPO_ROOT, 'bin', 'agent-device.mjs');
export const DEFAULT_OUT_DIR = path.join(HERE, '.results');

export type PerfConfig = {
  platform: Platform;
  rounds: number; // measured rounds (samples per command)
  warmup: number; // leading rounds dropped from stats
  keepArtifacts: boolean; // keep temp state dir + leave device booted
  outDir: string;
  udid?: string; // iOS device override (UDID)
  device?: string; // device override by name (e.g. "iPhone 17 Pro"); preferred over udid
  serial?: string; // Android device override
};

// How to invoke the CLI. Defaults to the built dist binary (bin/agent-device.mjs).
// Set AGENT_DEVICE_PERF_CLI to run from source instead, e.g. on CI:
//   AGENT_DEVICE_PERF_CLI="--experimental-strip-types src/bin.ts"
// (matches the device workflows, which run from source and skip the dist build).
export function resolveCliArgv(): string[] {
  const override = process.env.AGENT_DEVICE_PERF_CLI?.trim();
  if (override) return override.split(/\s+/);
  return [CLI_BIN];
}

export function usesSourceCli(): boolean {
  return Boolean(process.env.AGENT_DEVICE_PERF_CLI?.trim());
}

function readValue(argv: string[], i: number, flag: string): string {
  const v = argv[i + 1];
  if (v === undefined) throw new Error(`Missing value for ${flag}`);
  return v;
}

export function parseConfig(argv: string[]): PerfConfig {
  const cfg: PerfConfig = {
    platform: 'ios',
    rounds: 5,
    warmup: 1,
    keepArtifacts: false,
    outDir: DEFAULT_OUT_DIR,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--platform': {
        const v = readValue(argv, i++, a);
        if (v !== 'ios' && v !== 'android') throw new Error(`Unknown platform: ${v}`);
        cfg.platform = v;
        break;
      }
      case '--n':
      case '--rounds':
        cfg.rounds = Number(readValue(argv, i++, a));
        break;
      case '--warmup':
        cfg.warmup = Number(readValue(argv, i++, a));
        break;
      case '--keep-artifacts':
        cfg.keepArtifacts = true;
        break;
      case '--out-dir':
        cfg.outDir = path.resolve(readValue(argv, i++, a));
        break;
      case '--udid':
        cfg.udid = readValue(argv, i++, a);
        break;
      case '--device':
        cfg.device = readValue(argv, i++, a);
        break;
      case '--serial':
        cfg.serial = readValue(argv, i++, a);
        break;
      default:
        throw new Error(`Unknown flag: ${a}`);
    }
  }
  if (!Number.isInteger(cfg.rounds) || cfg.rounds < 1) throw new Error('--n must be >= 1');
  if (!Number.isInteger(cfg.warmup) || cfg.warmup < 0) throw new Error('--warmup must be >= 0');
  return cfg;
}
