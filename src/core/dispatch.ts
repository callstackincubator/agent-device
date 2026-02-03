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
import { getInteractor } from '../utils/interactors.ts';
import { runIosRunnerCommand } from '../platforms/ios/runner-client.ts';
import { snapshotAx } from '../platforms/ios/ax-snapshot.ts';
import { setIosSetting } from '../platforms/ios/index.ts';
import type { RawSnapshotNode } from '../utils/snapshot.ts';

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
  snapshotBackend?: 'ax' | 'xctest' | 'hybrid';
  noRecord?: boolean;
  recordJson?: boolean;
  appsFilter?: 'launchable' | 'user-installed' | 'all';
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
    traceLogPath?: string;
    snapshotInteractiveOnly?: boolean;
    snapshotCompact?: boolean;
    snapshotDepth?: number;
    snapshotScope?: string;
    snapshotRaw?: boolean;
    snapshotBackend?: 'ax' | 'xctest' | 'hybrid';
  },
): Promise<Record<string, unknown> | void> {
  const interactor = getInteractor(device);
  switch (command) {
    case 'open': {
      const app = positionals[0];
      if (!app) {
        await interactor.openDevice();
        return { app: null };
      }
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
        await runIosRunnerCommand(
          device,
          { command: 'tap', x, y, appBundleId: context?.appBundleId },
          { verbose: context?.verbose, logPath: context?.logPath, traceLogPath: context?.traceLogPath },
        );
      } else {
        await interactor.tap(x, y);
      }
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
        await runIosRunnerCommand(
          device,
          { command: 'tap', x, y, appBundleId: context?.appBundleId },
          { verbose: context?.verbose, logPath: context?.logPath, traceLogPath: context?.traceLogPath },
        );
      } else {
        await interactor.focus(x, y);
      }
      return { x, y };
    }
    case 'type': {
      const text = positionals.join(' ');
      if (!text) throw new AppError('INVALID_ARGS', 'type requires text');
      if (device.platform === 'ios' && device.kind === 'simulator') {
        await runIosRunnerCommand(
          device,
          { command: 'type', text, appBundleId: context?.appBundleId },
          { verbose: context?.verbose, logPath: context?.logPath, traceLogPath: context?.traceLogPath },
        );
      } else {
        await interactor.type(text);
      }
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
        await runIosRunnerCommand(
          device,
          { command: 'tap', x, y, appBundleId: context?.appBundleId },
          { verbose: context?.verbose, logPath: context?.logPath, traceLogPath: context?.traceLogPath },
        );
        await runIosRunnerCommand(
          device,
          { command: 'type', text, appBundleId: context?.appBundleId },
          { verbose: context?.verbose, logPath: context?.logPath, traceLogPath: context?.traceLogPath },
        );
      } else {
        await interactor.fill(x, y, text);
      }
      return { x, y, text };
    }
    case 'scroll': {
      const direction = positionals[0];
      const amount = positionals[1] ? Number(positionals[1]) : undefined;
      if (!direction) throw new AppError('INVALID_ARGS', 'scroll requires direction');
      if (device.platform === 'ios' && device.kind === 'simulator') {
        if (!['up', 'down', 'left', 'right'].includes(direction)) {
          throw new AppError('INVALID_ARGS', `Unknown direction: ${direction}`);
        }
        const inverted = invertScrollDirection(direction as 'up' | 'down' | 'left' | 'right');
        await runIosRunnerCommand(
          device,
          { command: 'swipe', direction: inverted, appBundleId: context?.appBundleId },
          { verbose: context?.verbose, logPath: context?.logPath, traceLogPath: context?.traceLogPath },
        );
      } else {
        await interactor.scroll(direction, amount);
      }
      return { direction, amount };
    }
    case 'scrollintoview': {
      const text = positionals.join(' ').trim();
      if (!text) throw new AppError('INVALID_ARGS', 'scrollintoview requires text');
      if (device.platform === 'ios' && device.kind === 'simulator') {
        const maxAttempts = 8;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          const found = (await runIosRunnerCommand(
            device,
            { command: 'findText', text, appBundleId: context?.appBundleId },
            { verbose: context?.verbose, logPath: context?.logPath, traceLogPath: context?.traceLogPath },
          )) as { found?: boolean };
          if (found?.found) return { text, attempts: attempt + 1 };
          await runIosRunnerCommand(
            device,
            { command: 'swipe', direction: 'up', appBundleId: context?.appBundleId },
            { verbose: context?.verbose, logPath: context?.logPath, traceLogPath: context?.traceLogPath },
          );
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        throw new AppError('COMMAND_FAILED', `scrollintoview could not find text: ${text}`);
      }
      await interactor.scrollIntoView(text);
      return { text };
    }
    case 'screenshot': {
      const path = outPath ?? `./screenshot-${Date.now()}.png`;
      await interactor.screenshot(path);
      return { path };
    }
    case 'back': {
      if (device.platform === 'ios') {
        if (device.kind !== 'simulator') {
          throw new AppError('UNSUPPORTED_OPERATION', 'back is only supported on iOS simulators in v1');
        }
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
        if (device.kind !== 'simulator') {
          throw new AppError('UNSUPPORTED_OPERATION', 'home is only supported on iOS simulators in v1');
        }
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
        if (device.kind !== 'simulator') {
          throw new AppError('UNSUPPORTED_OPERATION', 'app-switcher is only supported on iOS simulators in v1');
        }
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
      const backend = context?.snapshotBackend ?? 'hybrid';
      if (device.platform === 'ios') {
        if (device.kind !== 'simulator') {
          throw new AppError(
            'UNSUPPORTED_OPERATION',
            'snapshot is only supported on iOS simulators in v1',
          );
        }
        if (backend === 'ax') {
          const ax = await snapshotAx(device, { traceLogPath: context?.traceLogPath });
          return { nodes: ax.nodes ?? [], truncated: false, backend: 'ax' };
        }
        if (backend === 'hybrid') {
          const ax = await snapshotAx(device, { traceLogPath: context?.traceLogPath });
          const axNodes = ax.nodes ?? [];
          const containers = findHybridContainers(axNodes);
          if (containers.length === 0) {
            return { nodes: axNodes, truncated: false, backend: 'hybrid' };
          }
          const merged = await fillHybridContainers(device, axNodes, containers, {
            appBundleId: context?.appBundleId,
            interactiveOnly: context?.snapshotInteractiveOnly,
            compact: context?.snapshotCompact,
            depth: context?.snapshotDepth,
            raw: context?.snapshotRaw,
            verbose: context?.verbose,
            logPath: context?.logPath,
            traceLogPath: context?.traceLogPath,
          });
          return { nodes: merged.nodes, truncated: merged.truncated, backend: 'hybrid' };
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
        return { nodes: result.nodes ?? [], truncated: result.truncated ?? false, backend: 'xctest' };
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

type HybridContainer = {
  index: number;
  depth: number;
  label?: string;
  identifier?: string;
  type?: string;
};

const hybridContainerTypes = new Set(['tabbar', 'toolbar', 'group']);

function findHybridContainers(nodes: RawSnapshotNode[]): HybridContainer[] {
  const containers: HybridContainer[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const depth = node.depth ?? 0;
    const nextDepth = nodes[i + 1]?.depth ?? -1;
    if (nextDepth > depth) continue;
    const normalized = normalizeSnapshotType(node.type);
    if (!hybridContainerTypes.has(normalized)) continue;
    containers.push({
      index: i,
      depth,
      label: node.label,
      identifier: node.identifier,
      type: node.type,
    });
  }
  return containers;
}

async function fillHybridContainers(
  device: DeviceInfo,
  axNodes: RawSnapshotNode[],
  containers: HybridContainer[],
  options: {
    appBundleId?: string;
    interactiveOnly?: boolean;
    compact?: boolean;
    depth?: number;
    raw?: boolean;
    verbose?: boolean;
    logPath?: string;
    traceLogPath?: string;
  },
): Promise<{ nodes: RawSnapshotNode[]; truncated: boolean }> {
  let merged = [...axNodes];
  let truncated = false;
  let offset = 0;
  for (const container of containers) {
    const scope = resolveContainerScope(container);
    if (!scope) continue;
    const result = (await runIosRunnerCommand(
      device,
      {
        command: 'snapshot',
        appBundleId: options.appBundleId,
        interactiveOnly: options.interactiveOnly,
        compact: options.compact,
        depth: options.depth,
        scope,
        raw: options.raw,
      },
      { verbose: options.verbose, logPath: options.logPath, traceLogPath: options.traceLogPath },
    )) as { nodes?: RawSnapshotNode[]; truncated?: boolean };
    if (result.truncated) truncated = true;
    const filtered = (result.nodes ?? []).filter((node) => {
      const normalized = normalizeSnapshotType(node.type);
      return normalized !== 'application' && normalized !== 'window';
    });
    if (filtered.length === 0) continue;
    const adjusted = adjustDepths(filtered, container.depth + 1);
    merged.splice(container.index + 1 + offset, 0, ...adjusted);
    offset += adjusted.length;
  }
  merged = merged.map((node, index) => ({ ...node, index }));
  return { nodes: merged, truncated };
}

function adjustDepths(nodes: RawSnapshotNode[], baseDepth: number): RawSnapshotNode[] {
  let minDepth = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const depth = node.depth ?? 0;
    if (depth < minDepth) minDepth = depth;
  }
  if (!Number.isFinite(minDepth)) minDepth = 0;
  return nodes.map((node) => ({
    ...node,
    depth: baseDepth + (node.depth ?? 0) - minDepth,
  }));
}

function normalizeSnapshotType(type?: string): string {
  if (!type) return '';
  let value = type.replace(/XCUIElementType/gi, '').toLowerCase();
  if (value.startsWith('ax')) {
    value = value.replace(/^ax/, '');
  }
  return value;
}

function resolveContainerScope(container: HybridContainer): string | null {
  const candidates = [container.label, container.identifier];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const value = candidate.trim();
    if (value) return value;
  }
  return null;
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

// Runner-only input on iOS simulators (simctl io input is not supported).
