import { AppError } from '../utils/errors.ts';
import { selectDevice, type DeviceInfo } from '../utils/device.ts';
import { listAndroidDevices } from '../platforms/android/devices.ts';
import { ensureAdb, snapshotAndroid } from '../platforms/android/index.ts';
import { listIosDevices } from '../platforms/ios/devices.ts';
import { getInteractor } from '../utils/interactors.ts';
import { runIosRunnerCommand } from '../platforms/ios/runner-client.ts';
import { snapshotAx } from '../platforms/ios/ax-snapshot.ts';
import type { RawSnapshotNode } from '../utils/snapshot.ts';
import { simctlSupportsInput } from '../platforms/ios/index.ts';

export type CommandFlags = {
  platform?: 'ios' | 'android';
  device?: string;
  udid?: string;
  serial?: string;
  out?: string;
  verbose?: boolean;
  snapshotInteractiveOnly?: boolean;
  snapshotCompact?: boolean;
  snapshotDepth?: number;
  snapshotScope?: string;
  snapshotRaw?: boolean;
  snapshotBackend?: 'ax' | 'xctest';
  noRecord?: boolean;
  recordJson?: boolean;
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
    verbose?: boolean;
    logPath?: string;
    snapshotInteractiveOnly?: boolean;
    snapshotCompact?: boolean;
    snapshotDepth?: number;
    snapshotScope?: string;
    snapshotRaw?: boolean;
  },
): Promise<Record<string, unknown> | void> {
  const interactor = getInteractor(device);
  switch (command) {
    case 'open': {
      const app = positionals[0];
      if (!app) throw new AppError('INVALID_ARGS', 'open requires an app name or bundle/package id');
      await interactor.open(app);
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
      if (device.platform === 'ios' && device.kind === 'simulator') {
        const supported = await simctlSupportsInput('tap');
        if (!supported) {
          await runIosRunnerCommand(
            device,
            {
              command: 'tap',
              x,
              y,
              appBundleId: context?.appBundleId,
            },
            { verbose: context?.verbose, logPath: context?.logPath },
          );
          return { x, y };
        }
      }
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
      if (device.platform === 'ios' && device.kind === 'simulator') {
        const supported = await simctlSupportsInput('tap');
        if (!supported) {
          await runIosRunnerCommand(
            device,
            {
              command: 'tap',
              x,
              y,
              appBundleId: context?.appBundleId,
            },
            { verbose: context?.verbose, logPath: context?.logPath },
          );
          return { x, y };
        }
      }
      await interactor.focus(x, y);
      return { x, y };
    }
    case 'type': {
      const text = positionals.join(' ');
      if (!text) throw new AppError('INVALID_ARGS', 'type requires text');
      if (device.platform === 'ios' && device.kind === 'simulator') {
        const supported = await simctlSupportsInput('keyboard');
        if (!supported) {
          await runIosRunnerCommand(
            device,
            {
              command: 'type',
              text,
              appBundleId: context?.appBundleId,
            },
            { verbose: context?.verbose, logPath: context?.logPath },
          );
          return { text };
        }
      }
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
      if (device.platform === 'ios' && device.kind === 'simulator') {
        const tapSupported = await simctlSupportsInput('tap');
        const keyboardSupported = await simctlSupportsInput('keyboard');
        if (!tapSupported || !keyboardSupported) {
          await runIosRunnerCommand(
            device,
            {
              command: 'tap',
              x,
              y,
              appBundleId: context?.appBundleId,
            },
            { verbose: context?.verbose, logPath: context?.logPath },
          );
          await runIosRunnerCommand(
            device,
            {
              command: 'type',
              text,
              appBundleId: context?.appBundleId,
            },
            { verbose: context?.verbose, logPath: context?.logPath },
          );
          return { x, y, text };
        }
      }
      await interactor.fill(x, y, text);
      return { x, y, text };
    }
    case 'scroll': {
      const direction = positionals[0];
      const amount = positionals[1] ? Number(positionals[1]) : undefined;
      if (!direction) throw new AppError('INVALID_ARGS', 'scroll requires direction');
      if (device.platform === 'ios' && device.kind === 'simulator') {
        const supported = await simctlSupportsInput('swipe');
        if (!supported) {
          if (!['up', 'down', 'left', 'right'].includes(direction)) {
            throw new AppError('INVALID_ARGS', `Unknown direction: ${direction}`);
          }
          const inverted = invertScrollDirection(direction as 'up' | 'down' | 'left' | 'right');
          await runIosRunnerCommand(
            device,
            {
              command: 'swipe',
              direction: inverted,
              appBundleId: context?.appBundleId,
            },
            { verbose: context?.verbose, logPath: context?.logPath },
          );
          return { direction, amount };
        }
      }
      await interactor.scroll(direction, amount);
      return { direction, amount };
    }
    case 'scrollintoview': {
      const text = positionals.join(' ');
      if (!text) throw new AppError('INVALID_ARGS', 'scrollintoview requires text');
      await interactor.scrollIntoView(text);
      return { text };
    }
    case 'screenshot': {
      const path = outPath ?? `./screenshot-${Date.now()}.png`;
      await interactor.screenshot(path);
      return { path };
    }
    case 'snapshot': {
      const backend = context?.snapshotBackend ?? 'ax';
      if (device.platform === 'ios') {
        if (device.kind !== 'simulator') {
          throw new AppError(
            'UNSUPPORTED_OPERATION',
            'snapshot is only supported on iOS simulators in v1',
          );
        }
        if (backend === 'ax') {
          try {
            const ax = await snapshotAx(device);
            return { nodes: ax.nodes ?? [], truncated: false };
          } catch (err) {
            if (context?.snapshotBackend === 'ax') {
              throw err;
            }
          }
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
          { verbose: context?.verbose, logPath: context?.logPath },
        )) as { nodes?: RawSnapshotNode[]; truncated?: boolean };
        return { nodes: result.nodes ?? [], truncated: result.truncated ?? false };
      }
      const androidResult = await snapshotAndroid(device, {
        interactiveOnly: context?.snapshotInteractiveOnly,
        compact: context?.snapshotCompact,
        depth: context?.snapshotDepth,
        scope: context?.snapshotScope,
        raw: context?.snapshotRaw,
      });
      return { nodes: androidResult.nodes ?? [], truncated: androidResult.truncated ?? false };
    }
    default:
      throw new AppError('INVALID_ARGS', `Unknown command: ${command}`);
  }
}

function invertScrollDirection(direction: 'up' | 'down' | 'left' | 'right'): 'up' | 'down' | 'left' | 'right' {
  switch (direction) {
    case 'up':
      return 'down';
    case 'down':
      return 'up';
    case 'left':
      return 'right';
    case 'right':
      return 'left';
  }
}
