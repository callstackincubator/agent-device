import { AppError } from '../utils/errors.ts';
import { selectDevice, type DeviceInfo } from '../utils/device.ts';
import { listAndroidDevices } from '../platforms/android/devices.ts';
import { ensureAdb } from '../platforms/android/index.ts';
import { listIosDevices } from '../platforms/ios/devices.ts';
import { getInteractor } from '../utils/interactors.ts';
import { runIosRunnerCommand } from '../platforms/ios/runner-client.ts';
import { simctlSupportsInput } from '../platforms/ios/index.ts';

export type CommandFlags = {
  platform?: 'ios' | 'android';
  device?: string;
  udid?: string;
  serial?: string;
  out?: string;
  verbose?: boolean;
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
  context?: { appBundleId?: string; verbose?: boolean; logPath?: string },
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
          await runIosRunnerCommand(
            device,
            {
              command: 'swipe',
              direction: direction as 'up' | 'down' | 'left' | 'right',
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
    default:
      throw new AppError('INVALID_ARGS', `Unknown command: ${command}`);
  }
}
