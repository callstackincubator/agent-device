import fs from 'node:fs';
import path from 'node:path';
import type { DeviceInfo } from '../utils/device.ts';
import { AppError } from '../utils/errors.ts';
import { runCmd } from '../utils/exec.ts';
import { assertAndroidPackageArgSafe, startAndroidAppLog } from './app-log-android.ts';
import { startIosDeviceAppLog, startIosSimulatorAppLog, startMacOsAppLog } from './app-log-ios.ts';
import type { AppLogResult } from './app-log-process.ts';
import { waitForChildExit } from './app-log-stream.ts';

export type { AppLogResult } from './app-log-process.ts';
export { APP_LOG_PID_FILENAME, cleanupStaleAppLogProcesses } from './app-log-process.ts';
export { assertAndroidPackageArgSafe } from './app-log-android.ts';
export {
  buildAppleLogPredicate,
  buildIosDeviceLogStreamArgs,
  buildIosLogPredicate,
} from './app-log-ios.ts';

export type AppLogDoctorResult = {
  checks: Record<string, boolean>;
  notes: string[];
};

const DEFAULT_MAX_APP_LOG_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_ROTATED_FILES = 1;

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getAppLogConfig(): { maxBytes: number; maxRotatedFiles: number } {
  return {
    maxBytes: parsePositiveIntEnv('AGENT_DEVICE_APP_LOG_MAX_BYTES', DEFAULT_MAX_APP_LOG_BYTES),
    maxRotatedFiles: parsePositiveIntEnv(
      'AGENT_DEVICE_APP_LOG_MAX_FILES',
      DEFAULT_MAX_ROTATED_FILES,
    ),
  };
}

function getAppLogRedactionPatterns(): RegExp[] {
  const raw = process.env.AGENT_DEVICE_APP_LOG_REDACT_PATTERNS;
  if (!raw) return [];
  const patterns = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const result: RegExp[] = [];
  for (const pattern of patterns) {
    try {
      result.push(new RegExp(pattern, 'gi'));
    } catch {
      // Skip invalid user pattern.
    }
  }
  return result;
}

export function rotateAppLogIfNeeded(
  outPath: string,
  config: { maxBytes: number; maxRotatedFiles: number },
): void {
  if (!fs.existsSync(outPath)) return;
  const stats = fs.statSync(outPath);
  if (stats.size < config.maxBytes) return;

  for (let index = config.maxRotatedFiles; index >= 1; index -= 1) {
    const from = index === 1 ? outPath : `${outPath}.${index - 1}`;
    const to = `${outPath}.${index}`;
    if (!fs.existsSync(from)) continue;
    if (fs.existsSync(to)) fs.unlinkSync(to);
    fs.renameSync(from, to);
  }
}

function ensureLogPath(outPath: string): void {
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  rotateAppLogIfNeeded(outPath, getAppLogConfig());
}

export function getAppLogPathMetadata(outPath: string): {
  exists: boolean;
  sizeBytes: number;
  modifiedAt?: string;
} {
  if (!fs.existsSync(outPath)) {
    return { exists: false, sizeBytes: 0 };
  }
  const stats = fs.statSync(outPath);
  return {
    exists: true,
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  };
}

export async function startAppLog(
  device: DeviceInfo,
  appBundleId: string,
  outPath: string,
  pidPath?: string,
): Promise<AppLogResult> {
  ensureLogPath(outPath);
  const stream = fs.createWriteStream(outPath, { flags: 'a' });
  const redactionPatterns = getAppLogRedactionPatterns();
  if (device.platform === 'ios') {
    if (device.kind === 'device') {
      return await startIosDeviceAppLog(device.id, stream, redactionPatterns, pidPath);
    }
    return await startIosSimulatorAppLog(appBundleId, stream, redactionPatterns, pidPath);
  }
  if (device.platform === 'android') {
    assertAndroidPackageArgSafe(appBundleId);
    return await startAndroidAppLog(device.id, appBundleId, stream, redactionPatterns, pidPath);
  }
  if (device.platform === 'macos') {
    return await startMacOsAppLog(appBundleId, stream, redactionPatterns, pidPath);
  }
  stream.end();
  throw new AppError('UNSUPPORTED_PLATFORM', `unsupported platform: ${device.platform}`);
}

export async function stopAppLog(appLog: AppLogResult): Promise<void> {
  await appLog.stop();
  await waitForChildExit(appLog.wait);
}

export async function runAppLogDoctor(
  device: DeviceInfo,
  appBundleId?: string,
): Promise<AppLogDoctorResult> {
  const checks: Record<string, boolean> = {};
  const notes: string[] = [];
  if (!appBundleId) {
    notes.push(
      'No app bundle is tracked in this session. Run open <app> first for app-scoped logs.',
    );
  }
  if (device.platform === 'android') {
    try {
      const adb = await runCmd('adb', ['version'], { allowFailure: true });
      checks.adbAvailable = adb.exitCode === 0;
    } catch {
      checks.adbAvailable = false;
    }
    if (appBundleId) {
      try {
        const pidof = await runCmd('adb', ['-s', device.id, 'shell', 'pidof', appBundleId], {
          allowFailure: true,
        });
        checks.androidPidVisible = pidof.stdout.trim().length > 0;
      } catch {
        checks.androidPidVisible = false;
      }
    }
  }
  if (device.platform === 'ios' && device.kind === 'simulator') {
    try {
      const simctl = await runCmd('xcrun', ['simctl', 'help'], { allowFailure: true });
      checks.simctlAvailable = simctl.exitCode === 0;
    } catch {
      checks.simctlAvailable = false;
    }
  }
  if (device.platform === 'ios' && device.kind === 'device') {
    try {
      const devicectl = await runCmd('xcrun', ['devicectl', '--version'], { allowFailure: true });
      checks.devicectlAvailable = devicectl.exitCode === 0;
    } catch {
      checks.devicectlAvailable = false;
    }
  }
  if (device.platform === 'macos') {
    try {
      const log = await runCmd('log', ['help'], { allowFailure: true });
      checks.logAvailable = log.exitCode === 0;
    } catch {
      checks.logAvailable = false;
    }
  }
  return { checks, notes };
}

export function appendAppLogMarker(outPath: string, marker: string): void {
  ensureLogPath(outPath);
  const line = `[agent-device][mark][${new Date().toISOString()}] ${marker.trim() || 'marker'}\n`;
  fs.appendFileSync(outPath, line, 'utf8');
}

export function clearAppLogFiles(outPath: string): {
  path: string;
  cleared: boolean;
  removedRotatedFiles: number;
} {
  const dir = path.dirname(outPath);
  const base = path.basename(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(outPath)) {
    fs.truncateSync(outPath, 0);
  } else {
    fs.writeFileSync(outPath, '', 'utf8');
  }
  let removedRotatedFiles = 0;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.startsWith(`${base}.`)) continue;
    const suffix = entry.slice(base.length + 1);
    if (!/^\d+$/.test(suffix)) continue;
    try {
      fs.unlinkSync(path.join(dir, entry));
      removedRotatedFiles += 1;
    } catch {
      // best-effort cleanup
    }
  }
  return { path: outPath, cleared: true, removedRotatedFiles };
}
