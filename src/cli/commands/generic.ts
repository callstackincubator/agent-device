import type { AgentDeviceClient, CommandRequestResult } from '../../client.ts';
import { CLIENT_COMMANDS } from '../../client-command-registry.ts';
import type {
  FindLocator,
  FindOptions,
  IsOptions,
  PermissionTarget,
  RecordOptions,
  SettingsUpdateOptions,
} from '../../client-types.ts';
import { announceReplayTestRun } from '../../cli-test.ts';
import { splitSelectorFromArgs } from '../../daemon/selectors.ts';
import { AppError } from '../../utils/errors.ts';
import type { CliFlags } from '../../utils/command-schema.ts';
import { buildSelectionOptions } from './shared.ts';
import { writeCommandCliOutput } from './output.ts';
import type { ClientCommandHandler, ClientCommandHandlerMap } from './router.ts';

type GenericClientCommandRunner = (params: {
  client: AgentDeviceClient;
  positionals: string[];
  flags: CliFlags;
}) => Promise<CommandRequestResult>;

export const genericClientCommandHandlers = {
  [CLIENT_COMMANDS.boot]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.boot,
    ({ client, flags }) =>
      client.devices.boot({ ...buildSelectionOptions(flags), headless: flags.headless }),
  ),
  [CLIENT_COMMANDS.push]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.push,
    ({ client, positionals, flags }) =>
      client.apps.push({
        ...buildSelectionOptions(flags),
        app: required(positionals[0], 'push requires bundleOrPackage'),
        payload: required(positionals[1], 'push requires payloadOrJson'),
      }),
  ),
  [CLIENT_COMMANDS.perf]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.perf,
    ({ client, flags }) => client.observability.perf(buildSelectionOptions(flags)),
  ),
  [CLIENT_COMMANDS.click]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.click,
    ({ client, positionals, flags }) =>
      client.interactions.click({
        ...readInteractionTarget(positionals),
        ...readSelectorSnapshotOptions(flags),
        ...buildSelectionOptions(flags),
        count: flags.count,
        intervalMs: flags.intervalMs,
        holdMs: flags.holdMs,
        jitterPx: flags.jitterPx,
        doubleTap: flags.doubleTap,
        button: flags.clickButton,
      }),
  ),
  [CLIENT_COMMANDS.get]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.get,
    ({ client, positionals, flags }) =>
      client.interactions.get({
        ...readElementTarget(positionals.slice(1)),
        ...readSelectorSnapshotOptions(flags),
        ...buildSelectionOptions(flags),
        format: readGetFormat(positionals[0]),
      }),
  ),
  [CLIENT_COMMANDS.replay]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.replay,
    ({ client, positionals, flags }) =>
      client.replay.run({
        ...buildSelectionOptions(flags),
        path: required(positionals[0], 'replay requires path'),
        update: flags.replayUpdate,
      }),
  ),
  [CLIENT_COMMANDS.test]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.test,
    ({ client, positionals, flags }) => {
      announceReplayTestRun({ json: flags.json });
      return client.replay.test({
        ...buildSelectionOptions(flags),
        paths: positionals,
        update: flags.replayUpdate,
        failFast: flags.failFast,
        timeoutMs: flags.timeoutMs,
        retries: flags.retries,
        artifactsDir: flags.artifactsDir,
        reportJunit: flags.reportJunit,
      });
    },
  ),
  [CLIENT_COMMANDS.batch]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.batch,
    ({ client, flags }) =>
      client.batch.run({
        ...buildSelectionOptions(flags),
        steps: flags.batchSteps ?? [],
        onError: flags.batchOnError,
        maxSteps: flags.batchMaxSteps,
        out: flags.out,
      }),
  ),
  [CLIENT_COMMANDS.press]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.press,
    ({ client, positionals, flags }) =>
      client.interactions.press({
        ...readInteractionTarget(positionals),
        ...readSelectorSnapshotOptions(flags),
        ...buildSelectionOptions(flags),
        count: flags.count,
        intervalMs: flags.intervalMs,
        holdMs: flags.holdMs,
        jitterPx: flags.jitterPx,
        doubleTap: flags.doubleTap,
      }),
  ),
  [CLIENT_COMMANDS.longPress]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.longPress,
    ({ client, positionals, flags }) =>
      client.interactions.longPress({
        ...buildSelectionOptions(flags),
        x: Number(positionals[0]),
        y: Number(positionals[1]),
        durationMs: optionalNumber(positionals[2]),
      }),
  ),
  [CLIENT_COMMANDS.swipe]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.swipe,
    ({ client, positionals, flags }) =>
      client.interactions.swipe({
        ...buildSelectionOptions(flags),
        from: { x: Number(positionals[0]), y: Number(positionals[1]) },
        to: { x: Number(positionals[2]), y: Number(positionals[3]) },
        durationMs: optionalNumber(positionals[4]),
        count: flags.count,
        pauseMs: flags.pauseMs,
        pattern: flags.pattern,
      }),
  ),
  [CLIENT_COMMANDS.focus]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.focus,
    ({ client, positionals, flags }) =>
      client.interactions.focus({
        ...buildSelectionOptions(flags),
        x: Number(positionals[0]),
        y: Number(positionals[1]),
      }),
  ),
  [CLIENT_COMMANDS.type]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.type,
    ({ client, positionals, flags }) =>
      client.interactions.type({
        ...buildSelectionOptions(flags),
        text: positionals.join(' '),
        delayMs: flags.delayMs,
      }),
  ),
  [CLIENT_COMMANDS.fill]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.fill,
    ({ client, positionals, flags }) =>
      client.interactions.fill({
        ...readFillTarget(positionals),
        ...readSelectorSnapshotOptions(flags),
        ...buildSelectionOptions(flags),
        delayMs: flags.delayMs,
      }),
  ),
  [CLIENT_COMMANDS.scroll]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.scroll,
    ({ client, positionals, flags }) =>
      client.interactions.scroll({
        ...buildSelectionOptions(flags),
        direction: readScrollDirection(positionals[0]),
        amount: optionalNumber(positionals[1]),
        pixels: flags.pixels,
      }),
  ),
  [CLIENT_COMMANDS.pinch]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.pinch,
    ({ client, positionals, flags }) =>
      client.interactions.pinch({
        ...buildSelectionOptions(flags),
        scale: Number(positionals[0]),
        x: optionalNumber(positionals[1]),
        y: optionalNumber(positionals[2]),
      }),
  ),
  [CLIENT_COMMANDS.triggerAppEvent]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.triggerAppEvent,
    ({ client, positionals, flags }) =>
      client.apps.triggerEvent({
        ...buildSelectionOptions(flags),
        event: required(positionals[0], 'trigger-app-event requires event'),
        payload: positionals[1]
          ? readJsonObject(positionals[1], 'trigger-app-event payload')
          : undefined,
      }),
  ),
  [CLIENT_COMMANDS.record]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.record,
    ({ client, positionals, flags }) =>
      client.recording.record({
        ...buildSelectionOptions(flags),
        action: readStartStop(positionals[0], 'record'),
        path: positionals[1],
        fps: flags.fps,
        quality: readRecordingQuality(flags.quality),
        hideTouches: flags.hideTouches,
      }),
  ),
  [CLIENT_COMMANDS.trace]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.trace,
    ({ client, positionals, flags }) =>
      client.recording.trace({
        ...buildSelectionOptions(flags),
        action: readStartStop(positionals[0], 'trace'),
        path: positionals[1],
      }),
  ),
  [CLIENT_COMMANDS.logs]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.logs,
    ({ client, positionals, flags }) =>
      client.observability.logs({
        ...buildSelectionOptions(flags),
        action: readLogsAction(positionals[0]),
        message: positionals.slice(1).join(' ') || undefined,
        restart: flags.restart,
      }),
  ),
  [CLIENT_COMMANDS.network]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.network,
    ({ client, positionals, flags }) =>
      client.observability.network({
        ...buildSelectionOptions(flags),
        action: readNetworkAction(positionals[0]),
        limit: optionalNumber(positionals[1]),
        include: flags.networkInclude ?? readNetworkInclude(positionals[2]),
      }),
  ),
  [CLIENT_COMMANDS.find]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.find,
    ({ client, positionals, flags }) =>
      client.interactions.find({
        ...readFindOptions(positionals),
        ...readFindSnapshotOptions(flags),
        ...buildSelectionOptions(flags),
        first: flags.findFirst,
        last: flags.findLast,
      }),
  ),
  [CLIENT_COMMANDS.is]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.is,
    ({ client, positionals, flags }) =>
      client.interactions.is({
        ...readIsOptions(positionals),
        ...readSelectorSnapshotOptions(flags),
        ...buildSelectionOptions(flags),
      }),
  ),
  [CLIENT_COMMANDS.settings]: createGenericClientCommandHandler(
    CLIENT_COMMANDS.settings,
    ({ client, positionals, flags }) =>
      client.settings.update(readSettingsOptions(positionals, flags)),
  ),
} satisfies ClientCommandHandlerMap;

function createGenericClientCommandHandler(
  command: string,
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

function readSelectorSnapshotOptions(flags: CliFlags) {
  return {
    depth: flags.snapshotDepth,
    scope: flags.snapshotScope,
    raw: flags.snapshotRaw,
  };
}

function readFindSnapshotOptions(flags: CliFlags) {
  return {
    depth: flags.snapshotDepth,
    raw: flags.snapshotRaw,
  };
}

function readInteractionTarget(positionals: string[]) {
  if (positionals[0]?.startsWith('@')) {
    return { ref: positionals[0], label: positionals.slice(1).join(' ') || undefined };
  }
  const selectorArgs = splitSelectorFromArgs(positionals);
  if (selectorArgs) return { selector: selectorArgs.selectorExpression };
  return { x: Number(positionals[0]), y: Number(positionals[1]) };
}

function readElementTarget(positionals: string[]) {
  if (positionals[0]?.startsWith('@')) {
    return { ref: positionals[0], label: positionals.slice(1).join(' ') || undefined };
  }
  const selector = positionals.join(' ').trim();
  if (!selector) throw new AppError('INVALID_ARGS', 'get requires @ref or selector expression');
  return { selector };
}

function readFillTarget(positionals: string[]) {
  if (positionals[0]?.startsWith('@')) {
    const text =
      positionals.length >= 3 ? positionals.slice(2).join(' ') : positionals.slice(1).join(' ');
    return {
      ref: positionals[0],
      label: positionals.length >= 3 ? positionals[1] : undefined,
      text,
    };
  }
  const selectorArgs = splitSelectorFromArgs(positionals, { preferTrailingValue: true });
  if (selectorArgs)
    return { selector: selectorArgs.selectorExpression, text: selectorArgs.rest.join(' ') };
  return {
    x: Number(positionals[0]),
    y: Number(positionals[1]),
    text: positionals.slice(2).join(' '),
  };
}

function readGetFormat(value: string | undefined): 'text' | 'attrs' {
  if (value === 'text' || value === 'attrs') return value;
  throw new AppError('INVALID_ARGS', 'get only supports text or attrs');
}

function readScrollDirection(value: string | undefined): 'up' | 'down' | 'left' | 'right' {
  if (value === 'up' || value === 'down' || value === 'left' || value === 'right') return value;
  throw new AppError('INVALID_ARGS', `Unknown direction: ${String(value)}`);
}

function readStartStop(value: string | undefined, command: string): 'start' | 'stop' {
  if (value === 'start' || value === 'stop') return value;
  throw new AppError('INVALID_ARGS', `${command} requires start|stop`);
}

function readRecordingQuality(value: number | undefined): RecordOptions['quality'] {
  if (value === undefined) return undefined;
  if ([5, 6, 7, 8, 9, 10].includes(value)) return value as RecordOptions['quality'];
  throw new AppError('INVALID_ARGS', `Invalid quality: ${value}`);
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

function readFindOptions(positionals: string[]): FindOptions {
  const locator = readFindLocator(positionals[0]);
  const hasExplicitLocator = locator !== undefined;
  const query = hasExplicitLocator ? positionals[1] : positionals[0];
  const actionOffset = hasExplicitLocator ? 2 : 1;
  const action = positionals[actionOffset];
  if (action === undefined) return { locator, query: required(query, 'find requires query') };
  if (action === 'get') {
    const subcommand = positionals[actionOffset + 1];
    if (subcommand === 'text') {
      return { locator, query: required(query, 'find requires query'), action: 'getText' };
    }
    if (subcommand === 'attrs') {
      return { locator, query: required(query, 'find requires query'), action: 'getAttrs' };
    }
    throw new AppError('INVALID_ARGS', 'find get only supports text or attrs');
  }
  if (action === 'wait') {
    return {
      locator,
      query: required(query, 'find requires query'),
      action: 'wait',
      timeoutMs: optionalNumber(positionals[actionOffset + 1]),
    };
  }
  if (action === 'fill' || action === 'type') {
    return {
      locator,
      query: required(query, 'find requires query'),
      action,
      value: positionals.slice(actionOffset + 1).join(' '),
    };
  }
  if (action === 'click' || action === 'focus' || action === 'exists') {
    return { locator, query: required(query, 'find requires query'), action };
  }
  throw new AppError('INVALID_ARGS', `Unsupported find action: ${action}`);
}

function readFindLocator(value: string | undefined): FindLocator | undefined {
  if (
    value === 'text' ||
    value === 'label' ||
    value === 'value' ||
    value === 'role' ||
    value === 'id'
  ) {
    return value;
  }
  return undefined;
}

function readIsOptions(positionals: string[]): IsOptions {
  const predicate = positionals[0];
  const split = splitSelectorFromArgs(positionals.slice(1), {
    preferTrailingValue: predicate === 'text',
  });
  if (!split) throw new AppError('INVALID_ARGS', 'is requires a selector expression');
  if (predicate === 'text') {
    return { predicate, selector: split.selectorExpression, value: split.rest.join(' ') };
  }
  if (
    predicate === 'visible' ||
    predicate === 'hidden' ||
    predicate === 'exists' ||
    predicate === 'editable' ||
    predicate === 'selected'
  ) {
    return { predicate, selector: split.selectorExpression };
  }
  throw new AppError(
    'INVALID_ARGS',
    'is requires predicate: visible|hidden|exists|editable|selected|text',
  );
}

function readSettingsOptions(positionals: string[], flags: CliFlags): SettingsUpdateOptions {
  const base = buildSelectionOptions(flags);
  const setting = positionals[0];
  const state = positionals[1];
  if (
    (setting === 'wifi' || setting === 'airplane' || setting === 'location') &&
    (state === 'on' || state === 'off')
  ) {
    return { ...base, setting, state };
  }
  if (setting === 'appearance' && (state === 'light' || state === 'dark' || state === 'toggle')) {
    return { ...base, setting, state };
  }
  if (
    (setting === 'faceid' || setting === 'touchid') &&
    (state === 'match' || state === 'nonmatch' || state === 'enroll' || state === 'unenroll')
  ) {
    return { ...base, setting, state };
  }
  if (setting === 'fingerprint' && (state === 'match' || state === 'nonmatch')) {
    return { ...base, setting, state };
  }
  if (setting === 'permission' && (state === 'grant' || state === 'deny' || state === 'reset')) {
    return {
      ...base,
      setting,
      state,
      permission: readPermission(positionals[2]),
      mode: readPermissionMode(positionals[3]),
    };
  }
  throw new AppError('INVALID_ARGS', 'Invalid settings arguments.');
}

function readPermission(value: string | undefined): PermissionTarget {
  switch (value) {
    case 'camera':
    case 'microphone':
    case 'photos':
    case 'contacts':
    case 'contacts-limited':
    case 'notifications':
    case 'calendar':
    case 'location':
    case 'location-always':
    case 'media-library':
    case 'motion':
    case 'reminders':
    case 'siri':
    case 'accessibility':
    case 'screen-recording':
    case 'input-monitoring':
      return value;
    default:
      throw new AppError('INVALID_ARGS', 'settings permission requires a permission target.');
  }
}

function readPermissionMode(value: string | undefined): 'full' | 'limited' | undefined {
  if (value === undefined || value === 'full' || value === 'limited') return value;
  throw new AppError('INVALID_ARGS', 'settings permission mode must be full or limited.');
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

function optionalNumber(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}
