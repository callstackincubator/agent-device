import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { findProjectRoot } from '../../utils/version.ts';
import { runCmdDetached } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';

type IosSimulatorCameraHelperState = {
  pid: number;
  shmName: string;
  videoPath: string;
  logPath: string;
  startedAt: string;
};

export type IosSimulatorCameraLaunch = {
  env: NodeJS.ProcessEnv;
  videoPath: string;
  shmName: string;
  helperPid: number;
};

const CAMERA_VENDOR_ROOT = path.join('third_party', 'serve-sim-camera');
const CAMERA_HELPER_RELATIVE_PATH = path.join(
  CAMERA_VENDOR_ROOT,
  'bin',
  'camera-helper',
);
const CAMERA_INJECTOR_RELATIVE_PATH = path.join(
  CAMERA_VENDOR_ROOT,
  'bin',
  'camera-injector.dylib',
);

export async function prepareIosSimulatorCameraVideo(params: {
  device: DeviceInfo;
  bundleId: string;
  videoPath: string;
}): Promise<IosSimulatorCameraLaunch> {
  assertIosSimulatorCameraSupported(params.device);
  const videoPath = await resolveReadableVideoPath(params.videoPath);
  const helperPath = resolveVendorExecutable(CAMERA_HELPER_RELATIVE_PATH);
  const injectorPath = resolveVendorExecutable(CAMERA_INJECTOR_RELATIVE_PATH);
  await stopIosSimulatorCameraVideo(params.device, params.bundleId);

  const shmName = buildShmName(params.device.id, params.bundleId);
  const logPath = helperLogPath(params.device, params.bundleId);
  await fsp.mkdir(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, 'w');
  let helperPid = 0;
  try {
    helperPid = runCmdDetached(
      helperPath,
      ['--shm', shmName, '--source', 'video', '--arg', videoPath],
      {
        stdio: ['ignore', logFd, logFd],
      },
    );
  } finally {
    fs.closeSync(logFd);
  }
  await writeHelperState(params.device, params.bundleId, {
    pid: helperPid,
    shmName,
    videoPath,
    logPath,
    startedAt: new Date().toISOString(),
  });

  return {
    videoPath,
    shmName,
    helperPid,
    env: {
      SIMCTL_CHILD_DYLD_INSERT_LIBRARIES: injectorPath,
      // Upstream serve-sim injector ABI. simctl strips the SIMCTL_CHILD_ prefix.
      SIMCTL_CHILD_SIMCAM_SHM_NAME: shmName,
      SIMCTL_CHILD_SIMCAM_MIRROR_MODE: 'auto',
    },
  };
}

export async function stopIosSimulatorCameraVideo(
  device: DeviceInfo,
  bundleId: string | undefined,
): Promise<void> {
  if (device.platform !== 'ios' || device.kind !== 'simulator' || !bundleId) return;
  const statePath = helperStatePath(device, bundleId);
  const state = await readHelperState(statePath);
  if (!state) return;
  try {
    if (state.pid > 0) {
      process.kill(state.pid, 'SIGTERM');
    }
  } catch (error) {
    if (!isMissingProcessError(error)) throw error;
  } finally {
    await fsp.rm(statePath, { force: true });
  }
}

function assertIosSimulatorCameraSupported(device: DeviceInfo): void {
  if (device.platform === 'ios' && device.kind === 'simulator') return;
  throw new AppError(
    'UNSUPPORTED_OPERATION',
    '--camera-video is supported only for iOS simulators.',
    {
      platform: device.platform,
      kind: device.kind,
    },
  );
}

async function resolveReadableVideoPath(value: string): Promise<string> {
  const resolvedPath = path.resolve(value);
  try {
    const stat = await fsp.stat(resolvedPath);
    if (stat.isFile()) return resolvedPath;
  } catch {}
  throw new AppError('INVALID_ARGS', `Camera video file does not exist: ${resolvedPath}`, {
    hint: 'Pass a readable sample video path to --camera-video.',
  });
}

function resolveVendorExecutable(relativePath: string): string {
  const executablePath = path.join(findProjectRoot(), relativePath);
  if (fs.existsSync(executablePath)) return executablePath;
  throw new AppError('COMMAND_FAILED', 'Bundled iOS simulator camera helper is missing.', {
    expectedPath: executablePath,
  });
}

function buildShmName(deviceId: string, bundleId: string): string {
  const hash = createHash('sha1')
    .update(`${deviceId}:${bundleId}:${Date.now()}`)
    .digest('hex')
    .slice(0, 12);
  return `/ad-camera-${hash}`;
}

function helperStatePath(device: DeviceInfo, bundleId: string): string {
  const key = `${device.id}-${bundleId}`.replaceAll(/[^A-Za-z0-9._-]/g, '-');
  return path.join(os.tmpdir(), 'agent-device-ios-camera', `${key}.json`);
}

function helperLogPath(device: DeviceInfo, bundleId: string): string {
  const key = `${device.id}-${bundleId}`.replaceAll(/[^A-Za-z0-9._-]/g, '-');
  return path.join(os.tmpdir(), 'agent-device-ios-camera', `${key}.log`);
}

async function writeHelperState(
  device: DeviceInfo,
  bundleId: string,
  state: IosSimulatorCameraHelperState,
): Promise<void> {
  const statePath = helperStatePath(device, bundleId);
  await fsp.mkdir(path.dirname(statePath), { recursive: true });
  await fsp.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function readHelperState(
  statePath: string,
): Promise<IosSimulatorCameraHelperState | undefined> {
  try {
    const state = JSON.parse(
      await fsp.readFile(statePath, 'utf8'),
    ) as Partial<IosSimulatorCameraHelperState>;
    if (
      typeof state.pid === 'number' &&
      typeof state.shmName === 'string' &&
      typeof state.videoPath === 'string' &&
      typeof state.logPath === 'string' &&
      typeof state.startedAt === 'string'
    ) {
      return state as IosSimulatorCameraHelperState;
    }
  } catch {}
  return undefined;
}

function isMissingProcessError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ESRCH'
  );
}
