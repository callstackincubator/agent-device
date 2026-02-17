import { promises as fs } from 'node:fs';
import pathModule from 'node:path';
import { AppError } from '../utils/errors.ts';
import { selectDevice, type DeviceInfo } from '../utils/device.ts';
import { listAndroidDevices } from '../platforms/android/devices.ts';
import {
  appSwitcherAndroid,
  backAndroid,
  ensureAdb,
  homeAndroid,
  setAndroidSetting,
  snapshotAndroid,
} from '../platforms/android/index.ts';
import { listIosDevices } from '../platforms/ios/devices.ts';
import { getInteractor, type RunnerContext } from '../utils/interactors.ts';
import { runIosRunnerCommand } from '../platforms/ios/runner-client.ts';
import { setIosSetting } from '../platforms/ios/index.ts';
import { isDeepLinkTarget } from './open-target.ts';
import type { RawSnapshotNode } from '../utils/snapshot.ts';
import type { CliFlags } from '../utils/command-schema.ts';

export type CommandFlags = Omit<CliFlags, 'json' | 'help' | 'version'>;

export async function resolveTargetDevice(flags: CommandFlags): Promise<DeviceInfo> {
  const selector = {
    platform: flags.platform,
    deviceName: flags.device,
    udid: flags.udid,
    serial: flags.serial,
  };

  if (selector.platform === 'android') {
    await ensureAdb();
    const devices = await listAndroidDevices();
    return await selectDevice(devices, selector);
  }

  if (selector.platform === 'ios') {
    const devices = await listIosDevices();
    return await selectDevice(devices, selector);
  }

  const devices: DeviceInfo[] = [];
  try {
    devices.push(...(await listAndroidDevices()));
  } catch {
    // ignore
  }
  try {
    devices.push(...(await listIosDevices()));
  } catch {
    // ignore
  }
  return await selectDevice(devices, selector);
}

export async function dispatchCommand(
  device: DeviceInfo,
  command: string,
  positionals: string[],
  outPath?: string,
  context?: {
    appBundleId?: string;
    activity?: string;
    verbose?: boolean;
    logPath?: string;
    traceLogPath?: string;
    snapshotInteractiveOnly?: boolean;
    snapshotCompact?: boolean;
    snapshotDepth?: number;
    snapshotScope?: string;
    snapshotRaw?: boolean;
    count?: number;
    intervalMs?: number;
    holdMs?: number;
    jitterPx?: number;
    pauseMs?: number;
    pattern?: 'one-way' | 'ping-pong';
  },
): Promise<Record<string, unknown> | void> {
  const runnerCtx: RunnerContext = {
    appBundleId: context?.appBundleId,
    verbose: context?.verbose,
    logPath: context?.logPath,
    traceLogPath: context?.traceLogPath,
  };
  const interactor = getInteractor(device, runnerCtx);
  switch (command) {
    case 'open': {
      const app = positionals[0];
      const url = positionals[1];
      if (positionals.length > 2) {
        throw new AppError('INVALID_ARGS', 'open accepts at most two arguments: <app|url> [url]');
      }
      if (!app) {
        await interactor.openDevice();
        return { app: null };
      }
      if (url !== undefined) {
        if (device.platform !== 'ios') {
          throw new AppError('INVALID_ARGS', 'open <app> <url> is supported only on iOS');
        }
        if (isDeepLinkTarget(app)) {
          throw new AppError('INVALID_ARGS', 'open <app> <url> requires an app target as the first argument');
        }
        if (!isDeepLinkTarget(url)) {
          throw new AppError('INVALID_ARGS', 'open <app> <url> requires a valid URL target');
        }
        await interactor.open(app, {
          activity: context?.activity,
          appBundleId: context?.appBundleId,
          url,
        });
        return { app, url };
      }
      await interactor.open(app, { activity: context?.activity, appBundleId: context?.appBundleId });
      return { app };
    }
    case 'close': {
      const app = positionals[0];
      if (!app) {
        return { closed: 'session' };
      }
      await interactor.close(app);
      return { app };
    }
    case 'press': {
      const [x, y] = positionals.map(Number);
      if (Number.isNaN(x) || Number.isNaN(y)) throw new AppError('INVALID_ARGS', 'press requires x y');
      const count = requireIntInRange(context?.count ?? 1, 'count', 1, 200);
      const intervalMs = requireIntInRange(context?.intervalMs ?? 0, 'interval-ms', 0, 10_000);
      const holdMs = requireIntInRange(context?.holdMs ?? 0, 'hold-ms', 0, 10_000);
      const jitterPx = requireIntInRange(context?.jitterPx ?? 0, 'jitter-px', 0, 100);

      for (let index = 0; index < count; index += 1) {
        const [dx, dy] = computeDeterministicJitter(index, jitterPx);
        const targetX = x + dx;
        const targetY = y + dy;
        if (holdMs > 0) await interactor.longPress(targetX, targetY, holdMs);
        else await interactor.tap(targetX, targetY);
        if (index < count - 1 && intervalMs > 0) await sleep(intervalMs);
      }

      return { x, y, count, intervalMs, holdMs, jitterPx };
    }
    case 'swipe': {
      const x1 = Number(positionals[0]);
      const y1 = Number(positionals[1]);
      const x2 = Number(positionals[2]);
      const y2 = Number(positionals[3]);
      if ([x1, y1, x2, y2].some(Number.isNaN)) {
        throw new AppError('INVALID_ARGS', 'swipe requires x1 y1 x2 y2 [durationMs]');
      }

      const requestedDurationMs = positionals[4] ? Number(positionals[4]) : 250;
      const durationMs = requireIntInRange(requestedDurationMs, 'durationMs', 16, 10_000);
      const effectiveDurationMs = device.platform === 'ios' ? 60 : durationMs;
      const count = requireIntInRange(context?.count ?? 1, 'count', 1, 200);
      const pauseMs = requireIntInRange(context?.pauseMs ?? 0, 'pause-ms', 0, 10_000);
      const pattern = context?.pattern ?? 'one-way';
      if (pattern !== 'one-way' && pattern !== 'ping-pong') {
        throw new AppError('INVALID_ARGS', `Invalid pattern: ${pattern}`);
      }

      for (let index = 0; index < count; index += 1) {
        const reverse = pattern === 'ping-pong' && index % 2 === 1;
        if (reverse) await interactor.swipe(x2, y2, x1, y1, effectiveDurationMs);
        else await interactor.swipe(x1, y1, x2, y2, effectiveDurationMs);
        if (index < count - 1 && pauseMs > 0) await sleep(pauseMs);
      }

      return {
        x1,
        y1,
        x2,
        y2,
        durationMs,
        effectiveDurationMs,
        timingMode: device.platform === 'ios' ? 'safe-normalized' : 'direct',
        count,
        pauseMs,
        pattern,
      };
    }
    case 'long-press': {
      const x = Number(positionals[0]);
      const y = Number(positionals[1]);
      const durationMs = positionals[2] ? Number(positionals[2]) : undefined;
      if (Number.isNaN(x) || Number.isNaN(y)) {
        throw new AppError('INVALID_ARGS', 'long-press requires x y [durationMs]');
      }
      await interactor.longPress(x, y, durationMs);
      return { x, y, durationMs };
    }
    case 'focus': {
      const [x, y] = positionals.map(Number);
      if (Number.isNaN(x) || Number.isNaN(y)) throw new AppError('INVALID_ARGS', 'focus requires x y');
      await interactor.focus(x, y);
      return { x, y };
    }
    case 'type': {
      const text = positionals.join(' ');
      if (!text) throw new AppError('INVALID_ARGS', 'type requires text');
      await interactor.type(text);
      return { text };
    }
    case 'fill': {
      const x = Number(positionals[0]);
      const y = Number(positionals[1]);
      const text = positionals.slice(2).join(' ');
      if (Number.isNaN(x) || Number.isNaN(y) || !text) {
        throw new AppError('INVALID_ARGS', 'fill requires x y text');
      }
      await interactor.fill(x, y, text);
      return { x, y, text };
    }
    case 'scroll': {
      const direction = positionals[0];
      const amount = positionals[1] ? Number(positionals[1]) : undefined;
      if (!direction) throw new AppError('INVALID_ARGS', 'scroll requires direction');
      await interactor.scroll(direction, amount);
      return { direction, amount };
    }
    case 'scrollintoview': {
      const text = positionals.join(' ').trim();
      if (!text) throw new AppError('INVALID_ARGS', 'scrollintoview requires text');
      const result = await interactor.scrollIntoView(text);
      if (result?.attempts) return { text, attempts: result.attempts };
      return { text };
    }
    case 'pinch': {
      if (device.platform === 'android') {
        throw new AppError(
          'UNSUPPORTED_OPERATION',
          'Android pinch is not supported in current adb backend; requires instrumentation-based backend.',
        );
      }
      const scale = Number(positionals[0]);
      const x = positionals[1] ? Number(positionals[1]) : undefined;
      const y = positionals[2] ? Number(positionals[2]) : undefined;
      if (Number.isNaN(scale) || scale <= 0) {
        throw new AppError('INVALID_ARGS', 'pinch requires scale > 0');
      }
      await runIosRunnerCommand(
        device,
        { command: 'pinch', scale, x, y, appBundleId: context?.appBundleId },
        { verbose: context?.verbose, logPath: context?.logPath, traceLogPath: context?.traceLogPath },
      );
      return { scale, x, y };
    }
    case 'screenshot': {
      const positionalPath = positionals[0];
      const screenshotPath = positionalPath ?? outPath ?? `./screenshot-${Date.now()}.png`;
      await fs.mkdir(pathModule.dirname(screenshotPath), { recursive: true });
      await interactor.screenshot(screenshotPath);
      return { path: screenshotPath };
    }
    case 'back': {
      if (device.platform === 'ios') {
        await runIosRunnerCommand(
          device,
          { command: 'back', appBundleId: context?.appBundleId },
          { verbose: context?.verbose, logPath: context?.logPath, traceLogPath: context?.traceLogPath },
        );
        return { action: 'back' };
      }
      await backAndroid(device);
      return { action: 'back' };
    }
    case 'home': {
      if (device.platform === 'ios') {
        await runIosRunnerCommand(
          device,
          { command: 'home', appBundleId: context?.appBundleId },
          { verbose: context?.verbose, logPath: context?.logPath, traceLogPath: context?.traceLogPath },
        );
        return { action: 'home' };
      }
      await homeAndroid(device);
      return { action: 'home' };
    }
    case 'app-switcher': {
      if (device.platform === 'ios') {
        await runIosRunnerCommand(
          device,
          { command: 'appSwitcher', appBundleId: context?.appBundleId },
          { verbose: context?.verbose, logPath: context?.logPath, traceLogPath: context?.traceLogPath },
        );
        return { action: 'app-switcher' };
      }
      await appSwitcherAndroid(device);
      return { action: 'app-switcher' };
    }
    case 'settings': {
      const [setting, state, appBundleId] = positionals;
      if (device.platform === 'ios') {
        await setIosSetting(device, setting, state, appBundleId ?? context?.appBundleId);
        return { setting, state };
      }
      await setAndroidSetting(device, setting, state);
      return { setting, state };
    }
    case 'snapshot': {
      if (device.platform === 'ios') {
        const result = (await runIosRunnerCommand(
          device,
          {
            command: 'snapshot',
            appBundleId: context?.appBundleId,
            interactiveOnly: context?.snapshotInteractiveOnly,
            compact: context?.snapshotCompact,
            depth: context?.snapshotDepth,
            scope: context?.snapshotScope,
            raw: context?.snapshotRaw,
          },
          { verbose: context?.verbose, logPath: context?.logPath, traceLogPath: context?.traceLogPath },
        )) as { nodes?: RawSnapshotNode[]; truncated?: boolean };
        const nodes = result.nodes ?? [];
        if (nodes.length === 0 && device.kind === 'simulator') {
          throw new AppError(
            'COMMAND_FAILED',
            'XCTest snapshot returned 0 nodes on iOS simulator.',
          );
        }
        return { nodes, truncated: result.truncated ?? false, backend: 'xctest' };
      }
      const androidResult = await snapshotAndroid(device, {
        interactiveOnly: context?.snapshotInteractiveOnly,
        compact: context?.snapshotCompact,
        depth: context?.snapshotDepth,
        scope: context?.snapshotScope,
        raw: context?.snapshotRaw,
      });
      return { nodes: androidResult.nodes ?? [], truncated: androidResult.truncated ?? false, backend: 'android' };
    }
    default:
      throw new AppError('INVALID_ARGS', `Unknown command: ${command}`);
  }
}

const DETERMINISTIC_JITTER_PATTERN: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

function requireIntInRange(value: number, name: string, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw new AppError('INVALID_ARGS', `${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function computeDeterministicJitter(index: number, jitterPx: number): [number, number] {
  if (jitterPx <= 0) return [0, 0];
  const [dx, dy] = DETERMINISTIC_JITTER_PATTERN[index % DETERMINISTIC_JITTER_PATTERN.length];
  return [dx * jitterPx, dy * jitterPx];
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
