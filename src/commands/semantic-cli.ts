import type {
  AgentDeviceClient,
  BatchStep,
  CommandRequestResult,
  InteractionTarget,
  RecordOptions,
} from '../client.ts';
import {
  elementTargetCodec,
  fillCommandCodec,
  findCommandCodec,
  interactionTargetCodec,
  isCommandCodec,
  longPressCommandCodec,
  settingsCommandCodec,
  typeCommandCodec,
  waitCommandCodec,
} from '../command-codecs.ts';
import { parseDeviceRotation } from '../core/device-rotation.ts';
import { screenshotOptionsFromFlags } from './capture-screenshot-options.ts';
import { assertResolvedAppsFilter } from './app-inventory-contract.ts';
import { resolveInstallSource } from '../command-codecs/install-source.ts';
import { AppError } from '../utils/errors.ts';
import type { CliFlags } from '../utils/command-schema.ts';
import { compactRecord } from './semantic-common.ts';
import {
  isSemanticBatchCommand,
  runSemanticCommand,
  type SemanticBatchCommand,
  type SemanticCliCommand,
} from './semantic-command-surface.ts';

type SemanticCliRunOptions = {
  client: AgentDeviceClient;
  command: SemanticCliCommand;
  positionals: string[];
  flags: CliFlags;
};

export async function runSemanticCliCommand(
  options: SemanticCliRunOptions,
): Promise<CommandRequestResult> {
  const input = semanticInputFromCli(options.command, options.positionals, options.flags);
  return (await runSemanticCommand(options.client, options.command, input)) as CommandRequestResult;
}

function semanticInputFromCli(
  command: SemanticCliCommand,
  positionals: string[],
  flags: CliFlags,
): Record<string, unknown> {
  switch (command) {
    case 'devices':
      return commonInputFromFlags(flags);
    case 'apps':
      return {
        ...commonInputFromFlags(flags),
        appsFilter: assertResolvedAppsFilter(flags.appsFilter),
      };
    case 'session':
      return {
        ...commonInputFromFlags(flags),
        action: positionals[0] ?? 'list',
      };
    case 'boot':
      return {
        ...commonInputFromFlags(flags),
        headless: flags.headless,
      };
    case 'open':
      return {
        ...commonInputFromFlags(flags),
        app: positionals[0],
        url: positionals[1],
        surface: flags.surface,
        activity: flags.activity,
        launchConsole: flags.launchConsole,
        relaunch: flags.relaunch,
        saveScript: flags.saveScript,
        noRecord: flags.noRecord,
      };
    case 'close':
      return {
        ...commonInputFromFlags(flags),
        app: positionals[0],
        shutdown: flags.shutdown,
        saveScript: flags.saveScript,
      };
    case 'install':
    case 'reinstall':
      return {
        ...commonInputFromFlags(flags),
        app: required(positionals[0], `${command} requires app`),
        appPath: required(positionals[1], `${command} requires path`),
      };
    case 'install-from-source':
      return {
        ...commonInputFromFlags(flags),
        source: resolveInstallSource(positionals, flags),
        retainPaths: flags.retainPaths,
        retentionMs: flags.retentionMs,
      };
    case 'snapshot':
      return {
        ...commonInputFromFlags(flags),
        interactiveOnly: flags.snapshotInteractiveOnly,
        compact: flags.snapshotCompact,
        depth: flags.snapshotDepth,
        scope: flags.snapshotScope,
        raw: flags.snapshotRaw,
        forceFull: flags.snapshotForceFull,
      };
    case 'screenshot':
      return {
        ...commonInputFromFlags(flags),
        path: positionals[0] ?? flags.out,
        ...screenshotOptionsFromFlags(flags),
      };
    case 'diff':
      if (positionals[0] !== 'snapshot') {
        throw new AppError('INVALID_ARGS', 'Only diff snapshot is semantically migrated.');
      }
      return {
        ...commonInputFromFlags(flags),
        kind: 'snapshot',
        out: flags.out,
        interactiveOnly: flags.snapshotInteractiveOnly,
        compact: flags.snapshotCompact,
        depth: flags.snapshotDepth,
        scope: flags.snapshotScope,
        raw: flags.snapshotRaw,
      };
    case 'metro':
      return metroInputFromCli(positionals, flags);
    case 'click':
      return {
        ...commonInputFromFlags(flags),
        ...selectorSnapshotInputFromFlags(flags),
        ...repeatedInputFromFlags(flags),
        target: semanticTargetFromClientTarget(interactionTargetCodec.decode(positionals)),
        button: flags.clickButton,
      };
    case 'push':
      return {
        ...commonInputFromFlags(flags),
        app: required(positionals[0], 'push requires bundleOrPackage'),
        payload: required(positionals[1], 'push requires payloadOrJson'),
      };
    case 'perf':
      return commonInputFromFlags(flags);
    case 'get':
      return {
        ...commonInputFromFlags(flags),
        ...selectorSnapshotInputFromFlags(flags),
        format: readGetFormat(positionals[0]),
        target: semanticTargetFromClientTarget(elementTargetCodec.decode(positionals.slice(1))),
      };
    case 'replay':
      return {
        ...commonInputFromFlags(flags),
        path: required(positionals[0], 'replay requires path'),
        update: flags.replayUpdate,
        backend: flags.replayMaestro ? 'maestro' : undefined,
        env: flags.replayEnv,
      };
    case 'test':
      return {
        ...commonInputFromFlags(flags),
        paths: positionals,
        update: flags.replayUpdate,
        env: flags.replayEnv,
        failFast: flags.failFast,
        timeoutMs: flags.timeoutMs,
        retries: flags.retries,
        artifactsDir: flags.artifactsDir,
        reportJunit: flags.reportJunit,
      };
    case 'press':
      return {
        ...commonInputFromFlags(flags),
        ...selectorSnapshotInputFromFlags(flags),
        ...repeatedInputFromFlags(flags),
        target: semanticTargetFromClientTarget(interactionTargetCodec.decode(positionals)),
      };
    case 'longpress': {
      const decoded = longPressCommandCodec.decode(positionals);
      return {
        ...commonInputFromFlags(flags),
        ...selectorSnapshotInputFromFlags(flags),
        target: semanticTargetFromClientTarget(decoded),
        durationMs: decoded.durationMs,
      };
    }
    case 'swipe':
      return {
        ...commonInputFromFlags(flags),
        from: { x: Number(positionals[0]), y: Number(positionals[1]) },
        to: { x: Number(positionals[2]), y: Number(positionals[3]) },
        durationMs: optionalNumber(positionals[4]),
        count: flags.count,
        pauseMs: flags.pauseMs,
        pattern: flags.pattern,
      };
    case 'fill': {
      const decoded = fillCommandCodec.decode(positionals);
      return {
        ...commonInputFromFlags(flags),
        ...selectorSnapshotInputFromFlags(flags),
        target: semanticTargetFromClientTarget(decoded.target),
        text: decoded.text,
        delayMs: flags.delayMs,
      };
    }
    case 'batch':
      return {
        ...commonInputFromFlags(flags),
        steps: semanticBatchStepsFromCli(flags.batchSteps ?? []),
        onError: flags.batchOnError,
        maxSteps: flags.batchMaxSteps,
        out: flags.out,
      };
    case 'gesture':
      return gestureInputFromCli(positionals, flags);
    case 'focus':
      return {
        ...commonInputFromFlags(flags),
        x: Number(positionals[0]),
        y: Number(positionals[1]),
      };
    case 'type':
      return {
        ...commonInputFromFlags(flags),
        ...typeCommandCodec.decode(positionals, flags),
      };
    case 'scroll':
      return {
        ...commonInputFromFlags(flags),
        direction: readScrollDirection(positionals[0]),
        amount: optionalNumber(positionals[1]),
        pixels: flags.pixels,
      };
    case 'trigger-app-event':
      return {
        ...commonInputFromFlags(flags),
        event: required(positionals[0], 'trigger-app-event requires event'),
        payload: positionals[1]
          ? readJsonObject(positionals[1], 'trigger-app-event payload')
          : undefined,
      };
    case 'record':
      return {
        ...commonInputFromFlags(flags),
        action: readStartStop(positionals[0], 'record'),
        path: positionals[1],
        fps: flags.fps,
        quality: flags.quality as RecordOptions['quality'],
        hideTouches: flags.hideTouches,
      };
    case 'trace':
      return {
        ...commonInputFromFlags(flags),
        action: readStartStop(positionals[0], 'trace'),
        path: positionals[1],
      };
    case 'logs':
      return {
        ...commonInputFromFlags(flags),
        action: readLogsAction(positionals[0]),
        message: positionals.slice(1).join(' ') || undefined,
        restart: flags.restart,
      };
    case 'network':
      return {
        ...commonInputFromFlags(flags),
        action: readNetworkAction(positionals[0]),
        limit: optionalNumber(positionals[1]),
        include: flags.networkInclude ?? readNetworkInclude(positionals[2]),
      };
    case 'react-native':
      return {
        ...commonInputFromFlags(flags),
        action: readReactNativeAction(positionals[0]),
      };
    case 'find':
      return findCommandCodec.decode(positionals, flags) as Record<string, unknown>;
    case 'is':
      return isCommandCodec.decode(positionals, flags) as Record<string, unknown>;
    case 'settings':
      return settingsCommandCodec.decode(positionals, flags) as Record<string, unknown>;
    case 'wait':
      return waitCommandCodec.decode(positionals, flags) as Record<string, unknown>;
    case 'alert':
      return {
        ...commonInputFromFlags(flags),
        ...readAlertInput(positionals),
      };
    case 'appstate':
    case 'home':
    case 'app-switcher':
      return commonInputFromFlags(flags);
    case 'back':
      return {
        ...commonInputFromFlags(flags),
        mode: flags.backMode,
      };
    case 'rotate':
      return {
        ...commonInputFromFlags(flags),
        orientation: parseDeviceRotation(positionals[0]),
      };
    case 'keyboard':
      return {
        ...commonInputFromFlags(flags),
        ...readKeyboardInput(positionals),
      };
    case 'clipboard':
      return {
        ...commonInputFromFlags(flags),
        ...readClipboardInput(positionals),
      };
  }
}

function semanticBatchStepsFromCli(
  steps: BatchStep[],
): Array<{ command: string; input: Record<string, unknown> }> {
  return steps.map((step, index) => {
    const command = readBatchCliCommand(step.command, index + 1);
    const input = semanticInputFromCli(
      command,
      step.positionals ?? [],
      cliFlagsFromBatchStep(step.flags),
    );
    if (step.runtime !== undefined) input.runtime = step.runtime;
    return { command, input };
  });
}

function readBatchCliCommand(command: string, stepNumber: number): SemanticBatchCommand {
  const normalized = command.trim().toLowerCase();
  if (isSemanticBatchCommand(normalized)) return normalized;
  throw new AppError(
    'INVALID_ARGS',
    `Batch step ${stepNumber} command is not available through semantic batch: ${command}`,
  );
}

function cliFlagsFromBatchStep(flags: BatchStep['flags']): CliFlags {
  return {
    json: false,
    help: false,
    version: false,
    ...(flags as Partial<CliFlags> | undefined),
  };
}

function gestureInputFromCli(positionals: string[], flags: CliFlags): Record<string, unknown> {
  const subcommand = positionals[0];
  const args = positionals.slice(1);
  const common = commonInputFromFlags(flags);
  switch (subcommand) {
    case 'pan':
      return {
        ...common,
        kind: subcommand,
        origin: { x: Number(args[0]), y: Number(args[1]) },
        delta: { x: Number(args[2]), y: Number(args[3]) },
        durationMs: optionalNumber(args[4]),
      };
    case 'fling':
      return {
        ...common,
        kind: subcommand,
        direction: args[0],
        origin: { x: Number(args[1]), y: Number(args[2]) },
        distance: optionalNumber(args[3]),
        durationMs: optionalNumber(args[4]),
      };
    case 'pinch':
      return {
        ...common,
        kind: subcommand,
        scale: Number(args[0]),
        origin:
          args[1] === undefined || args[2] === undefined
            ? undefined
            : { x: Number(args[1]), y: Number(args[2]) },
      };
    case 'rotate':
      return {
        ...common,
        kind: subcommand,
        degrees: Number(args[0]),
        origin:
          args[1] === undefined || args[2] === undefined
            ? undefined
            : { x: Number(args[1]), y: Number(args[2]) },
        velocity: optionalNumber(args[3]),
      };
    case 'transform':
      return {
        ...common,
        kind: subcommand,
        origin: { x: Number(args[0]), y: Number(args[1]) },
        delta: { x: Number(args[2]), y: Number(args[3]) },
        scale: Number(args[4]),
        degrees: Number(args[5]),
        durationMs: optionalNumber(args[6]),
      };
    default:
      throw new AppError(
        'INVALID_ARGS',
        'gesture requires pan, fling, pinch, rotate, or transform',
      );
  }
}

function metroInputFromCli(positionals: string[], flags: CliFlags): Record<string, unknown> {
  const action = (positionals[0] ?? '').toLowerCase();
  if (action !== 'prepare' && action !== 'reload') {
    throw new AppError('INVALID_ARGS', 'metro requires a subcommand: prepare or reload');
  }
  if (action === 'reload') {
    return {
      action,
      metroHost: flags.metroHost,
      metroPort: flags.metroPort,
      bundleUrl: flags.bundleUrl,
      timeoutMs: flags.metroProbeTimeoutMs,
    };
  }
  if (!flags.metroPublicBaseUrl && !flags.metroProxyBaseUrl) {
    throw new AppError(
      'INVALID_ARGS',
      'metro prepare requires --public-base-url <url> or --proxy-base-url <url>.',
    );
  }
  return {
    action,
    projectRoot: flags.metroProjectRoot,
    kind: flags.metroKind,
    port: flags.metroPreparePort,
    listenHost: flags.metroListenHost,
    statusHost: flags.metroStatusHost,
    publicBaseUrl: flags.metroPublicBaseUrl,
    proxyBaseUrl: flags.metroProxyBaseUrl,
    bearerToken: flags.metroBearerToken,
    bridgeScope:
      flags.tenant && flags.runId && flags.leaseId
        ? {
            tenantId: flags.tenant,
            runId: flags.runId,
            leaseId: flags.leaseId,
          }
        : undefined,
    startupTimeoutMs: flags.metroStartupTimeoutMs,
    probeTimeoutMs: flags.metroProbeTimeoutMs,
    reuseExisting: flags.metroNoReuseExisting ? false : undefined,
    installDependenciesIfNeeded: flags.metroNoInstallDeps ? false : undefined,
    runtimeFilePath: flags.metroRuntimeFile,
  };
}

function commonInputFromFlags(flags: CliFlags): Record<string, unknown> {
  return compactRecord({
    session: flags.session,
    platform: flags.platform,
    deviceTarget: flags.target,
    device: flags.device,
    udid: flags.udid,
    serial: flags.serial,
    iosSimulatorDeviceSet: flags.iosSimulatorDeviceSet,
    androidDeviceAllowlist: flags.androidDeviceAllowlist,
  });
}

function selectorSnapshotInputFromFlags(flags: CliFlags): Record<string, unknown> {
  return compactRecord({
    depth: flags.snapshotDepth,
    scope: flags.snapshotScope,
    raw: flags.snapshotRaw,
  });
}

function repeatedInputFromFlags(flags: CliFlags): Record<string, unknown> {
  return compactRecord({
    count: flags.count,
    intervalMs: flags.intervalMs,
    holdMs: flags.holdMs,
    jitterPx: flags.jitterPx,
    doubleTap: flags.doubleTap,
  });
}

function semanticTargetFromClientTarget(target: InteractionTarget): Record<string, unknown> {
  if (target.ref !== undefined) {
    return compactRecord({ kind: 'ref', ref: target.ref, label: target.label });
  }
  if (target.selector !== undefined) {
    return { kind: 'selector', selector: target.selector };
  }
  return { kind: 'point', x: target.x, y: target.y };
}

function readGetFormat(value: string | undefined): 'text' | 'attrs' {
  if (value === 'text' || value === 'attrs') return value;
  throw new AppError('INVALID_ARGS', 'get only supports text or attrs');
}

function readScrollDirection(
  value: string | undefined,
): 'up' | 'down' | 'left' | 'right' | 'top' | 'bottom' {
  if (
    value === 'up' ||
    value === 'down' ||
    value === 'left' ||
    value === 'right' ||
    value === 'top' ||
    value === 'bottom'
  ) {
    return value;
  }
  throw new AppError('INVALID_ARGS', `Unknown direction: ${String(value)}`);
}

function readStartStop(value: string | undefined, command: string): 'start' | 'stop' {
  if (value === 'start' || value === 'stop') return value;
  throw new AppError('INVALID_ARGS', `${command} requires start|stop`);
}

function readLogsAction(
  value: string | undefined,
): 'path' | 'start' | 'stop' | 'doctor' | 'mark' | 'clear' | undefined {
  if (value === undefined) return undefined;
  if (
    value === 'path' ||
    value === 'start' ||
    value === 'stop' ||
    value === 'doctor' ||
    value === 'mark' ||
    value === 'clear'
  ) {
    return value;
  }
  throw new AppError('INVALID_ARGS', 'logs requires path, start, stop, doctor, mark, or clear');
}

function readNetworkAction(value: string | undefined): 'dump' | 'log' | undefined {
  if (value === undefined) return undefined;
  if (value === 'dump' || value === 'log') return value;
  throw new AppError('INVALID_ARGS', 'network requires dump or log');
}

function readNetworkInclude(
  value: string | undefined,
): 'summary' | 'headers' | 'body' | 'all' | undefined {
  if (value === undefined) return undefined;
  if (value === 'summary' || value === 'headers' || value === 'body' || value === 'all')
    return value;
  throw new AppError('INVALID_ARGS', 'network include mode must be summary, headers, body, or all');
}

function readJsonObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  throw new AppError('INVALID_ARGS', `${label} must be a JSON object`);
}

function required(value: string | undefined, message: string): string {
  if (value === undefined || value === '') throw new AppError('INVALID_ARGS', message);
  return value;
}

function readReactNativeAction(value: string | undefined): 'dismiss-overlay' {
  if (value === 'dismiss-overlay') return value;
  throw new AppError('INVALID_ARGS', 'react-native supports only: dismiss-overlay');
}

function readAlertInput(positionals: string[]): Record<string, unknown> {
  if (positionals.length > 2) {
    throw new AppError('INVALID_ARGS', 'alert accepts at most action and timeout arguments.');
  }
  const action = readAlertAction(positionals[0]);
  const timeoutMs = readFiniteNumber(positionals[1], 'alert timeout');
  return compactRecord({ action, timeoutMs });
}

function readKeyboardInput(positionals: string[]): Record<string, unknown> {
  if (positionals.length > 1) {
    throw new AppError('INVALID_ARGS', 'keyboard accepts at most one action argument.');
  }
  return compactRecord({ action: readKeyboardAction(positionals[0]) });
}

function readClipboardInput(positionals: string[]): Record<string, unknown> {
  const action = positionals[0]?.toLowerCase();
  if (action !== 'read' && action !== 'write') {
    throw new AppError('INVALID_ARGS', 'clipboard requires a subcommand: read or write.');
  }
  if (action === 'read') {
    if (positionals.length !== 1) {
      throw new AppError('INVALID_ARGS', 'clipboard read does not accept additional arguments.');
    }
    return { action };
  }
  if (positionals.length < 2) {
    throw new AppError('INVALID_ARGS', 'clipboard write requires text.');
  }
  return { action, text: positionals.slice(1).join(' ') };
}

function readAlertAction(
  value: string | undefined,
): 'get' | 'accept' | 'dismiss' | 'wait' | undefined {
  const action = value?.toLowerCase();
  if (
    action === undefined ||
    action === 'get' ||
    action === 'accept' ||
    action === 'dismiss' ||
    action === 'wait'
  ) {
    return action;
  }
  throw new AppError('INVALID_ARGS', 'alert action must be get, accept, dismiss, or wait.');
}

function readKeyboardAction(value: string | undefined): 'status' | 'dismiss' | undefined {
  const action = value?.toLowerCase();
  if (action === 'get') return 'status';
  if (action === undefined || action === 'status' || action === 'dismiss') {
    return action;
  }
  throw new AppError('INVALID_ARGS', 'keyboard action must be status, get, or dismiss.');
}

function readFiniteNumber(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  throw new AppError('INVALID_ARGS', `${label} must be a finite number.`);
}

function optionalNumber(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}
