import type { AgentDeviceClient, CommandRequestResult } from '../../client.ts';
import type { RecordOptions } from '../../client-types.ts';
import { announceReplayTestRun } from '../../cli-test.ts';
import { runTypeCliCommand } from '../../commands/interactions/cli.ts';
import { AppError } from '../../utils/errors.ts';
import type { CliFlags } from '../../utils/command-schema.ts';
import {
  elementTargetCodec,
  fillCommandCodec,
  findCommandCodec,
  interactionTargetCodec,
  isCommandCodec,
  longPressCommandCodec,
  settingsCommandCodec,
} from '../../command-codecs.ts';
import { selectorSnapshotOptionsFromFlags } from '../../command-codecs/flags.ts';
import { buildSelectionOptions } from './shared.ts';
import { writeCommandCliOutput } from './output.ts';
import { GESTURE_SUBCOMMAND_ERROR, type PublicCommandName } from '../../command-catalog.ts';
import type { ClientCommandHandler } from './router-types.ts';

type GenericClientCommandRunner = (params: {
  client: AgentDeviceClient;
  positionals: string[];
  flags: CliFlags;
}) => Promise<CommandRequestResult>;

const genericClientCommandRunners = {
  boot: ({ client, flags }) =>
    client.devices.boot({ ...buildSelectionOptions(flags), headless: flags.headless }),
  push: ({ client, positionals, flags }) =>
    client.apps.push({
      ...buildSelectionOptions(flags),
      app: required(positionals[0], 'push requires bundleOrPackage'),
      payload: required(positionals[1], 'push requires payloadOrJson'),
    }),
  perf: ({ client, flags }) => client.observability.perf(buildSelectionOptions(flags)),
  click: ({ client, positionals, flags }) =>
    client.interactions.click({
      ...interactionTargetCodec.decode(positionals),
      ...selectorSnapshotOptionsFromFlags(flags),
      ...buildSelectionOptions(flags),
      count: flags.count,
      intervalMs: flags.intervalMs,
      holdMs: flags.holdMs,
      jitterPx: flags.jitterPx,
      doubleTap: flags.doubleTap,
      button: flags.clickButton,
    }),
  get: ({ client, positionals, flags }) =>
    client.interactions.get({
      ...elementTargetCodec.decode(positionals.slice(1)),
      ...selectorSnapshotOptionsFromFlags(flags),
      ...buildSelectionOptions(flags),
      format: readGetFormat(positionals[0]),
    }),
  replay: ({ client, positionals, flags }) =>
    client.replay.run({
      ...buildSelectionOptions(flags),
      path: required(positionals[0], 'replay requires path'),
      update: flags.replayUpdate,
      backend: flags.replayMaestro ? 'maestro' : undefined,
      env: flags.replayEnv,
      timeoutMs: flags.timeoutMs,
    }),
  test: ({ client, positionals, flags }) => {
    announceReplayTestRun({ json: flags.json });
    return client.replay.test({
      ...buildSelectionOptions(flags),
      paths: positionals,
      update: flags.replayUpdate,
      backend: flags.replayMaestro ? 'maestro' : undefined,
      env: flags.replayEnv,
      failFast: flags.failFast,
      timeoutMs: flags.timeoutMs,
      retries: flags.retries,
      artifactsDir: flags.artifactsDir,
      reportJunit: flags.reportJunit,
    });
  },
  batch: ({ client, flags }) =>
    client.batch.run({
      ...buildSelectionOptions(flags),
      steps: flags.batchSteps ?? [],
      onError: flags.batchOnError,
      maxSteps: flags.batchMaxSteps,
      out: flags.out,
    }),
  press: ({ client, positionals, flags }) =>
    client.interactions.press({
      ...interactionTargetCodec.decode(positionals),
      ...selectorSnapshotOptionsFromFlags(flags),
      ...buildSelectionOptions(flags),
      count: flags.count,
      intervalMs: flags.intervalMs,
      holdMs: flags.holdMs,
      jitterPx: flags.jitterPx,
      doubleTap: flags.doubleTap,
    }),
  longpress: ({ client, positionals, flags }) =>
    client.interactions.longPress({
      ...longPressCommandCodec.decode(positionals),
      ...selectorSnapshotOptionsFromFlags(flags),
      ...buildSelectionOptions(flags),
    }),
  swipe: ({ client, positionals, flags }) =>
    client.interactions.swipe({
      ...buildSelectionOptions(flags),
      from: { x: Number(positionals[0]), y: Number(positionals[1]) },
      to: { x: Number(positionals[2]), y: Number(positionals[3]) },
      durationMs: optionalNumber(positionals[4]),
      count: flags.count,
      pauseMs: flags.pauseMs,
      pattern: flags.pattern,
    }),
  gesture: ({ client, positionals, flags }) =>
    runGestureCommand({
      client,
      positionals,
      flags,
    }),
  focus: ({ client, positionals, flags }) =>
    client.interactions.focus({
      ...buildSelectionOptions(flags),
      x: Number(positionals[0]),
      y: Number(positionals[1]),
    }),
  type: runTypeCliCommand,
  fill: ({ client, positionals, flags }) => {
    const decoded = fillCommandCodec.decode(positionals);
    return client.interactions.fill({
      ...decoded.target,
      text: decoded.text,
      ...selectorSnapshotOptionsFromFlags(flags),
      ...buildSelectionOptions(flags),
      delayMs: flags.delayMs,
    });
  },
  scroll: ({ client, positionals, flags }) =>
    client.interactions.scroll({
      ...buildSelectionOptions(flags),
      direction: readScrollDirection(positionals[0]),
      amount: optionalNumber(positionals[1]),
      pixels: flags.pixels,
    }),
  'trigger-app-event': ({ client, positionals, flags }) =>
    client.apps.triggerEvent({
      ...buildSelectionOptions(flags),
      event: required(positionals[0], 'trigger-app-event requires event'),
      payload: positionals[1]
        ? readJsonObject(positionals[1], 'trigger-app-event payload')
        : undefined,
    }),
  record: ({ client, positionals, flags }) =>
    client.recording.record({
      ...buildSelectionOptions(flags),
      action: readStartStop(positionals[0], 'record'),
      path: positionals[1],
      fps: flags.fps,
      quality: flags.quality as RecordOptions['quality'],
      hideTouches: flags.hideTouches,
    }),
  trace: ({ client, positionals, flags }) =>
    client.recording.trace({
      ...buildSelectionOptions(flags),
      action: readStartStop(positionals[0], 'trace'),
      path: positionals[1],
    }),
  logs: ({ client, positionals, flags }) =>
    client.observability.logs({
      ...buildSelectionOptions(flags),
      action: readLogsAction(positionals[0]),
      message: positionals.slice(1).join(' ') || undefined,
      restart: flags.restart,
    }),
  network: ({ client, positionals, flags }) =>
    client.observability.network({
      ...buildSelectionOptions(flags),
      action: readNetworkAction(positionals[0]),
      limit: optionalNumber(positionals[1]),
      include: flags.networkInclude ?? readNetworkInclude(positionals[2]),
    }),
  'react-native': ({ client, positionals, flags }) =>
    client.command.reactNative({
      ...buildSelectionOptions(flags),
      action: readReactNativeAction(positionals[0]),
    }),
  find: ({ client, positionals, flags }) =>
    client.interactions.find(findCommandCodec.decode(positionals, flags)),
  is: ({ client, positionals, flags }) =>
    client.interactions.is(isCommandCodec.decode(positionals, flags)),
  settings: ({ client, positionals, flags }) =>
    client.settings.update(settingsCommandCodec.decode(positionals, flags)),
} satisfies Partial<Record<PublicCommandName, GenericClientCommandRunner>>;

function runGestureCommand(params: {
  client: AgentDeviceClient;
  positionals: string[];
  flags: CliFlags;
}): Promise<CommandRequestResult> {
  const { client, positionals, flags } = params;
  const subcommand = required(positionals[0], 'gesture requires subcommand');
  const args = positionals.slice(1);
  switch (subcommand) {
    case 'pan':
      return client.interactions.pan({
        ...buildSelectionOptions(flags),
        x: Number(args[0]),
        y: Number(args[1]),
        dx: Number(args[2]),
        dy: Number(args[3]),
        durationMs: optionalNumber(args[4]),
      });
    case 'fling':
      return client.interactions.fling({
        ...buildSelectionOptions(flags),
        direction: readGestureDirection(args[0], 'gesture fling'),
        x: Number(args[1]),
        y: Number(args[2]),
        distance: optionalNumber(args[3]),
        durationMs: optionalNumber(args[4]),
      });
    case 'pinch':
      return client.interactions.pinch({
        ...buildSelectionOptions(flags),
        scale: Number(args[0]),
        x: optionalNumber(args[1]),
        y: optionalNumber(args[2]),
      });
    case 'rotate':
      return client.interactions.rotateGesture({
        ...buildSelectionOptions(flags),
        degrees: Number(args[0]),
        x: optionalNumber(args[1]),
        y: optionalNumber(args[2]),
        velocity: optionalNumber(args[3]),
      });
    case 'transform':
      return client.interactions.transformGesture({
        ...buildSelectionOptions(flags),
        x: Number(args[0]),
        y: Number(args[1]),
        dx: Number(args[2]),
        dy: Number(args[3]),
        scale: Number(args[4]),
        degrees: Number(args[5]),
        durationMs: optionalNumber(args[6]),
      });
    default:
      throw new AppError('INVALID_ARGS', GESTURE_SUBCOMMAND_ERROR);
  }
}

export const genericClientCommandHandlers = Object.fromEntries(
  Object.entries(genericClientCommandRunners).map(([command, run]) => [
    command,
    createGenericClientCommandHandler(
      command as PublicCommandName,
      run as GenericClientCommandRunner,
    ),
  ]),
) as { [TCommand in keyof typeof genericClientCommandRunners]: ClientCommandHandler };

function createGenericClientCommandHandler(
  command: PublicCommandName,
  run: GenericClientCommandRunner,
): ClientCommandHandler {
  return async ({ positionals, flags, client }) => {
    const data = await run({ client, positionals, flags });
    const exitCode = writeCommandCliOutput(command, positionals, flags, data);
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
    return true;
  };
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

function readGestureDirection(
  value: string | undefined,
  command: string,
): 'up' | 'down' | 'left' | 'right' {
  if (value === 'up' || value === 'down' || value === 'left' || value === 'right') return value;
  throw new AppError('INVALID_ARGS', `${command} direction must be up, down, left, or right`);
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

function optionalNumber(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}
