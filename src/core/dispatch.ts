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
import { snapshotAx } from '../platforms/ios/ax-snapshot.ts';
import { setIosSetting } from '../platforms/ios/index.ts';
import type { RawSnapshotNode } from '../utils/snapshot.ts';

export type CommandFlags = {
  session?: string;
  platform?: 'ios' | 'android';
  device?: string;
  udid?: string;
  serial?: string;
  out?: string;
  activity?: string;
  verbose?: boolean;
  snapshotInteractiveOnly?: boolean;
  snapshotCompact?: boolean;
  snapshotDepth?: number;
  snapshotScope?: string;
  snapshotRaw?: boolean;
  snapshotBackend?: 'ax' | 'xctest';
  saveScript?: boolean;
  noRecord?: boolean;
  appsFilter?: 'launchable' | 'user-installed' | 'all';
  appsMetadata?: boolean;
  replayUpdate?: boolean;
};

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
    snapshotBackend?: 'ax' | 'xctest';
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
      if (!app) {
        await interactor.openDevice();
        return { app: null };
      }
      await interactor.open(app, { activity: context?.activity });
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
      await interactor.tap(x, y);
      return { x, y };
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
      await interactor.scrollIntoView(text);
      return { text };
    }
    case 'pinch': {
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
      const backend = context?.snapshotBackend ?? 'xctest';
      if (device.platform === 'ios') {
        if (backend === 'ax') {
          const ax = await snapshotAx(device, { traceLogPath: context?.traceLogPath });
          return { nodes: ax.nodes ?? [], truncated: false, backend: 'ax' };
        }
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
        if (nodes.length === 0) {
          try {
            const ax = await snapshotAx(device, { traceLogPath: context?.traceLogPath });
            return { nodes: ax.nodes ?? [], truncated: false, backend: 'ax' };
          } catch {
            // keep the empty XCTest snapshot if AX is unavailable
          }
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

