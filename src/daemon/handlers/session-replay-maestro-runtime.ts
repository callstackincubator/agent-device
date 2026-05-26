import { type CommandFlags } from '../../core/dispatch.ts';
import { MAESTRO_RUNTIME_COMMAND } from '../../compat/maestro/runtime-commands.ts';
import { executeRunScriptFile } from '../../compat/maestro/run-script.ts';
import type { Platform } from '../../utils/device.ts';
import { type Rect, type SnapshotNode, type SnapshotState } from '../../utils/snapshot.ts';
import { sleep } from '../../utils/timeouts.ts';
import { asAppError } from '../../utils/errors.ts';
import type { ReplayVarScope } from '../../replay/vars.ts';
import { parseSelectorChain } from '../selectors.ts';
import { matchesSelector } from '../selectors-match.ts';
import { getSnapshotReferenceFrame, type TouchReferenceFrame } from '../touch-reference-frame.ts';
import type { DaemonRequest, DaemonResponse, SessionAction } from '../types.ts';
import { errorResponse } from './response.ts';

const MAESTRO_SCROLL_UNTIL_VISIBLE_PROBE_MS = 500;
const MAESTRO_TAP_ON_TIMEOUT_MS = 30000;
const MAESTRO_OPTIONAL_TAP_ON_TIMEOUT_MS = 3000;
const MAESTRO_TAP_ON_RETRY_MS = 250;
const MAESTRO_ANIMATION_POLL_MS = 250;

type ReplayBaseRequest = Omit<DaemonRequest, 'command' | 'positionals'>;

type MaestroReplayInvoker = (params: {
  action: SessionAction;
  line: number;
  step: number;
}) => Promise<DaemonResponse>;

type MaestroRuntimeInvoke = (req: DaemonRequest) => Promise<DaemonResponse>;
type FailedDaemonResponse = Extract<DaemonResponse, { ok: false }>;

type MaestroScrollUntilVisibleParams = {
  baseReq: ReplayBaseRequest;
  positionals: string[];
  invoke: MaestroRuntimeInvoke;
};

type MaestroTapOnParams = {
  baseReq: ReplayBaseRequest;
  positionals: string[];
  invoke: MaestroRuntimeInvoke;
};

type MaestroTapOnOptions = {
  childOf?: string;
  index?: number;
};

type MaestroRunFlowWhenCondition =
  | { ok: true; mode: string; predicate: string; selector: string }
  | { ok: false; response: DaemonResponse };

type MaestroSnapshotTarget = {
  node: SnapshotNode;
  rect: Rect;
  frame?: TouchReferenceFrame;
};

export async function invokeMaestroRuntimeCommand(params: {
  command: string;
  baseReq: ReplayBaseRequest;
  positionals: string[];
  batchSteps: CommandFlags['batchSteps'] | undefined;
  scope: ReplayVarScope;
  line: number;
  step: number;
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
  invokeReplayAction: MaestroReplayInvoker;
}): Promise<DaemonResponse | undefined> {
  switch (params.command) {
    case MAESTRO_RUNTIME_COMMAND.assertNotVisible:
      return await invokeMaestroAssertNotVisible(params);
    case MAESTRO_RUNTIME_COMMAND.pressEnter:
      return await invokeMaestroPressEnter(params);
    case MAESTRO_RUNTIME_COMMAND.waitForAnimationToEnd:
      return await invokeMaestroWaitForAnimationToEnd(params);
    case MAESTRO_RUNTIME_COMMAND.scrollUntilVisible:
      return await invokeMaestroScrollUntilVisible(params);
    case MAESTRO_RUNTIME_COMMAND.swipeOn:
      return await invokeMaestroSwipeOn(params);
    case MAESTRO_RUNTIME_COMMAND.tapOn:
      return await invokeMaestroTapOn(params);
    case MAESTRO_RUNTIME_COMMAND.tapPointPercent:
      return await invokeMaestroTapPointPercent(params);
    case MAESTRO_RUNTIME_COMMAND.runFlowWhen:
      return await invokeMaestroRunFlowWhen(params);
    case MAESTRO_RUNTIME_COMMAND.runScript:
      return invokeMaestroRunScript(params);
    default:
      return undefined;
  }
}

async function invokeMaestroPressEnter(params: {
  baseReq: ReplayBaseRequest;
  invoke: MaestroRuntimeInvoke;
}): Promise<DaemonResponse> {
  const keyboardResponse = await params.invoke({
    ...params.baseReq,
    command: 'keyboard',
    positionals: ['enter'],
  });
  if (keyboardResponse.ok) return keyboardResponse;

  return await params.invoke({
    ...params.baseReq,
    command: 'type',
    positionals: ['\n'],
  });
}

async function invokeMaestroAssertNotVisible(params: {
  baseReq: ReplayBaseRequest;
  positionals: string[];
  invoke: MaestroRuntimeInvoke;
}): Promise<DaemonResponse> {
  const [selector] = params.positionals;
  if (!selector) {
    return errorResponse('INVALID_ARGS', 'assertNotVisible requires a selector.');
  }
  const response = await params.invoke({
    ...params.baseReq,
    command: 'is',
    positionals: ['visible', selector],
    flags: { ...params.baseReq.flags, noRecord: true },
  });
  if (!response.ok) {
    return { ok: true, data: { pass: true, selector, absent: true } };
  }
  if (response.data?.pass === false) {
    return { ok: true, data: { pass: true, selector } };
  }
  return errorResponse('COMMAND_FAILED', `Expected not visible but matched: ${selector}`);
}

async function invokeMaestroWaitForAnimationToEnd(params: {
  baseReq: ReplayBaseRequest;
  positionals: string[];
  invoke: MaestroRuntimeInvoke;
}): Promise<DaemonResponse> {
  const timeoutMs = Number(params.positionals[0] ?? 15000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    return errorResponse('INVALID_ARGS', 'waitForAnimationToEnd timeout must be a number.');
  }
  const startedAt = Date.now();
  let previousSignature: string | undefined;
  let lastResponse: DaemonResponse | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    const response = await params.invoke({
      ...params.baseReq,
      command: 'snapshot',
      positionals: [],
      flags: {
        ...params.baseReq.flags,
        noRecord: true,
        snapshotRaw: true,
        snapshotForceFull: true,
      },
    });
    if (!response.ok) {
      lastResponse = response;
      await sleep(MAESTRO_ANIMATION_POLL_MS);
      continue;
    }
    const snapshot = readSnapshotState(response.data);
    if (!snapshot) return response;
    const signature = snapshotStabilitySignature(snapshot);
    if (previousSignature === signature) {
      return { ok: true, data: { stable: true, timeoutMs } };
    }
    previousSignature = signature;
    lastResponse = response;
    await sleep(MAESTRO_ANIMATION_POLL_MS);
  }

  return lastResponse?.ok === false
    ? lastResponse
    : { ok: true, data: { stable: false, timeoutMs } };
}

async function invokeMaestroScrollUntilVisible(
  params: MaestroScrollUntilVisibleParams,
): Promise<DaemonResponse> {
  const [selector, timeoutValue = '5000', direction = 'down'] = params.positionals;
  if (!selector) {
    return errorResponse('INVALID_ARGS', 'scrollUntilVisible requires a selector.');
  }
  const timeoutMs = Number(timeoutValue);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return errorResponse('INVALID_ARGS', 'scrollUntilVisible timeout must be a positive number.');
  }
  const fuzzyTextQuery = extractMaestroVisibleTextQuery(selector);
  const attempts = Math.max(1, Math.ceil(timeoutMs / MAESTRO_SCROLL_UNTIL_VISIBLE_PROBE_MS));
  let lastWaitResponse: FailedDaemonResponse | null = null;

  for (let index = 0; index < attempts; index += 1) {
    const probeResponse = await probeMaestroScrollVisibility(
      params,
      selector,
      fuzzyTextQuery,
      scrollProbeMs(timeoutMs, index),
    );
    if (probeResponse.ok) return probeResponse;
    lastWaitResponse = probeResponse;

    if (index === attempts - 1) break;

    const scrollResponse = await params.invoke({
      ...params.baseReq,
      command: 'scroll',
      positionals: [direction],
    });
    if (!scrollResponse.ok) return scrollResponse;
  }

  return withMaestroScrollTimeoutContext(lastWaitResponse, selector, timeoutMs);
}

async function probeMaestroScrollVisibility(
  params: MaestroScrollUntilVisibleParams,
  selector: string,
  fuzzyTextQuery: string | null,
  probeMs: number,
): Promise<DaemonResponse> {
  const waitResponse = await params.invoke({
    ...params.baseReq,
    command: 'wait',
    positionals: [selector, String(probeMs)],
  });
  if (waitResponse.ok || !fuzzyTextQuery) return waitResponse;

  const fuzzyResponse = await params.invoke({
    ...params.baseReq,
    command: 'find',
    positionals: [fuzzyTextQuery, 'wait', String(probeMs)],
  });
  return fuzzyResponse;
}

function scrollProbeMs(timeoutMs: number, index: number): number {
  return Math.min(
    MAESTRO_SCROLL_UNTIL_VISIBLE_PROBE_MS,
    Math.max(1, timeoutMs - index * MAESTRO_SCROLL_UNTIL_VISIBLE_PROBE_MS),
  );
}

async function invokeMaestroTapPointPercent(params: {
  baseReq: ReplayBaseRequest;
  positionals: string[];
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
}): Promise<DaemonResponse> {
  const [xValue, yValue] = params.positionals;
  const xPercent = Number(xValue);
  const yPercent = Number(yValue);
  if (!Number.isFinite(xPercent) || !Number.isFinite(yPercent)) {
    return errorResponse('INVALID_ARGS', 'tapOn percentage point requires numeric x/y values.');
  }

  const snapshotResponse = await params.invoke({
    ...params.baseReq,
    command: 'snapshot',
    positionals: [],
    flags: {
      ...params.baseReq.flags,
      noRecord: true,
      snapshotRaw: true,
      snapshotForceFull: true,
    },
  });
  if (!snapshotResponse.ok) return snapshotResponse;

  const snapshot = readSnapshotState(snapshotResponse.data);
  if (!snapshot) {
    return errorResponse(
      'COMMAND_FAILED',
      'Unable to read snapshot data for Maestro percentage point tap.',
    );
  }

  const frame = getSnapshotReferenceFrame(snapshot);
  if (!frame) {
    return errorResponse(
      'COMMAND_FAILED',
      'Unable to resolve screen size for Maestro percentage point tap.',
    );
  }

  return await params.invoke({
    ...params.baseReq,
    command: 'click',
    positionals: [
      String(Math.round((frame.referenceWidth * xPercent) / 100)),
      String(Math.round((frame.referenceHeight * yPercent) / 100)),
    ],
  });
}

function readSnapshotState(data: unknown): SnapshotState | undefined {
  if (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { nodes?: unknown }).nodes)
  ) {
    return data as SnapshotState;
  }
  return undefined;
}

function snapshotStabilitySignature(snapshot: SnapshotState): string {
  return JSON.stringify(
    snapshot.nodes.map((node) => ({
      index: node.index,
      parentIndex: node.parentIndex,
      type: node.type,
      identifier: node.identifier,
      label: node.label,
      value: node.value,
      rect: node.rect
        ? {
            x: Math.round(node.rect.x),
            y: Math.round(node.rect.y),
            width: Math.round(node.rect.width),
            height: Math.round(node.rect.height),
          }
        : undefined,
    })),
  );
}

async function invokeMaestroTapOn(params: MaestroTapOnParams): Promise<DaemonResponse> {
  const [selector, rawOptions] = params.positionals;
  if (!selector) {
    return errorResponse('INVALID_ARGS', 'tapOn requires a selector.');
  }
  const options = readMaestroTapOnOptions(rawOptions);
  if (!options.ok) return options.response;
  const startedAt = Date.now();
  const fuzzyTextQuery = extractMaestroVisibleTextQuery(selector);
  const timeoutMs =
    params.baseReq.flags?.maestro?.optional === true
      ? MAESTRO_OPTIONAL_TAP_ON_TIMEOUT_MS
      : MAESTRO_TAP_ON_TIMEOUT_MS;
  let lastResponse: DaemonResponse | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    const attempt = await invokeMaestroSnapshotTapOn(params, selector, options.value ?? {});
    if (attempt.ok) return attempt;
    lastResponse = attempt;
    if (fuzzyTextQuery) {
      const fuzzyAttempt = await invokeMaestroFuzzyTapOn(params, fuzzyTextQuery);
      if (!fuzzyAttempt.retry) return fuzzyAttempt.response;
      lastResponse = fuzzyAttempt.response;
    }
    await sleep(MAESTRO_TAP_ON_RETRY_MS);
  }

  if (params.baseReq.flags?.maestro?.optional === true) {
    return { ok: true, data: { skipped: true, optional: true, selector } };
  }
  return (
    lastResponse ?? errorResponse('COMMAND_FAILED', `tapOn timed out for selector: ${selector}`)
  );
}

async function invokeMaestroSnapshotTapOn(
  params: MaestroTapOnParams,
  selector: string,
  options: MaestroTapOnOptions,
): Promise<DaemonResponse> {
  const target = await resolveMaestroSnapshotTarget(params, selector, options, 'tapOn');
  if (!target.ok) return target.response;
  const point = pointForMaestroTapOnTarget(target.target, selector);
  return await params.invoke({
    ...params.baseReq,
    command: 'click',
    positionals: [String(point.x), String(point.y)],
  });
}

async function invokeMaestroSwipeOn(params: {
  baseReq: ReplayBaseRequest;
  positionals: string[];
  invoke: MaestroRuntimeInvoke;
}): Promise<DaemonResponse> {
  const [selector, direction = 'up', durationMs] = params.positionals;
  if (!selector) return errorResponse('INVALID_ARGS', 'swipe.label requires a label selector.');
  const target = await resolveMaestroSnapshotTarget(params, selector, {}, 'swipe.label');
  if (!target.ok) return target.response;
  const swipe = swipeCoordinatesFromTarget(target.target, direction);
  if (!swipe.ok) return swipe.response;
  return await params.invoke({
    ...params.baseReq,
    command: 'swipe',
    positionals: [
      String(swipe.start.x),
      String(swipe.start.y),
      String(swipe.end.x),
      String(swipe.end.y),
      ...(durationMs ? [durationMs] : []),
    ],
  });
}

async function invokeMaestroFuzzyTapOn(
  params: MaestroTapOnParams,
  query: string,
): Promise<{ retry: boolean; response: DaemonResponse }> {
  const findResponse = await params.invoke({
    ...params.baseReq,
    command: 'find',
    positionals: [query, 'click'],
    flags: {
      ...params.baseReq.flags,
      findFirst: true,
    },
  });
  if (findResponse.ok) return { retry: false, response: findResponse };
  return { retry: true, response: findResponse };
}

async function resolveMaestroSnapshotTarget(
  params: {
    baseReq: ReplayBaseRequest;
    invoke: MaestroRuntimeInvoke;
  },
  selector: string,
  options: MaestroTapOnOptions,
  commandLabel: string,
): Promise<{ ok: true; target: MaestroSnapshotTarget } | { ok: false; response: DaemonResponse }> {
  const snapshotResponse = await params.invoke({
    ...params.baseReq,
    command: 'snapshot',
    positionals: [],
    flags: {
      ...params.baseReq.flags,
      noRecord: true,
      snapshotRaw: true,
      snapshotForceFull: true,
    },
  });
  if (!snapshotResponse.ok) return { ok: false, response: snapshotResponse };

  const snapshot = readSnapshotState(snapshotResponse.data);
  if (!snapshot) {
    return {
      ok: false,
      response: errorResponse(
        'COMMAND_FAILED',
        `Unable to read snapshot data for ${commandLabel}.`,
      ),
    };
  }

  const frame = getSnapshotReferenceFrame(snapshot);
  const resolution = resolveMaestroNodeFromSnapshot(
    snapshot,
    selector,
    options,
    readMaestroSelectorPlatform(params.baseReq.flags),
    frame,
  );
  if (!resolution.ok) {
    return {
      ok: false,
      response: errorResponse('ELEMENT_NOT_FOUND', resolution.message),
    };
  }
  return {
    ok: true,
    target: {
      node: resolution.node,
      rect: resolution.rect,
      frame,
    },
  };
}

function resolveMaestroNodeFromSnapshot(
  snapshot: SnapshotState,
  selector: string,
  options: MaestroTapOnOptions,
  platform: Platform,
  frame: TouchReferenceFrame | undefined,
): { ok: true; node: SnapshotNode; rect: Rect } | { ok: false; message: string } {
  let matches = findMaestroSelectorMatches(snapshot, selector, platform);
  if (options.childOf) {
    const parents = findMaestroSelectorMatches(snapshot, options.childOf, platform);
    if (parents.length === 0) {
      return { ok: false, message: `Maestro childOf parent did not match: ${options.childOf}` };
    }
    matches = matches.filter((node) =>
      parents.some((parent) => isDescendantOfSnapshotNode(snapshot.nodes, node, parent)),
    );
  }

  const target = selectMaestroSnapshotMatch(
    snapshot.nodes,
    matches,
    options.index,
    extractMaestroVisibleTextQuery(selector) !== null,
    frame,
  );
  if (!target) {
    const index = options.index ?? 0;
    return {
      ok: false,
      message: `Maestro selector did not match index ${index}: ${selector}`,
    };
  }
  return { ok: true, node: target.node, rect: target.rect };
}

function findMaestroSelectorMatches(
  snapshot: SnapshotState,
  selectorExpression: string,
  platform: Platform,
): SnapshotNode[] {
  const chain = parseSelectorChain(selectorExpression);
  for (const selector of chain.selectors) {
    const matches = snapshot.nodes.filter((node) => matchesSelector(node, selector, platform));
    if (matches.length > 0) return matches;
  }
  return [];
}

function resolveNodeRect(nodes: SnapshotState['nodes'], node: SnapshotNode): Rect | null {
  if (node.rect && node.rect.width > 0 && node.rect.height > 0) return node.rect;
  let current: SnapshotNode | undefined = node;
  const byIndex = new Map(nodes.map((candidate) => [candidate.index, candidate]));
  while (typeof current.parentIndex === 'number') {
    current = byIndex.get(current.parentIndex) ?? nodes[current.parentIndex];
    if (!current) return null;
    if (current.rect && current.rect.width > 0 && current.rect.height > 0) return current.rect;
  }
  return null;
}

function selectMaestroSnapshotMatch(
  nodes: SnapshotState['nodes'],
  matches: SnapshotNode[],
  index: number | undefined,
  preferOnScreen: boolean,
  frame: TouchReferenceFrame | undefined,
): { node: SnapshotNode; rect: Rect } | null {
  const resolved = matches
    .map((node) => {
      const rect = resolveNodeRect(nodes, node);
      return rect ? { node, rect } : null;
    })
    .filter((candidate): candidate is { node: SnapshotNode; rect: Rect } => Boolean(candidate));
  const candidates =
    preferOnScreen && index === undefined ? preferOnScreenMatches(resolved, frame) : resolved;
  if (index !== undefined) return candidates[index] ?? null;
  return candidates.sort(compareMaestroSnapshotMatches)[0] ?? null;
}

function preferOnScreenMatches(
  matches: { node: SnapshotNode; rect: Rect }[],
  frame: TouchReferenceFrame | undefined,
): { node: SnapshotNode; rect: Rect }[] {
  const onScreen = matches.filter((match) => isRectOnScreen(match.rect, frame));
  return onScreen.length > 0 ? onScreen : matches;
}

function isRectOnScreen(rect: Rect, frame: TouchReferenceFrame | undefined): boolean {
  const maxX = frame?.referenceWidth ?? Number.POSITIVE_INFINITY;
  const maxY = frame?.referenceHeight ?? Number.POSITIVE_INFINITY;
  return rect.x < maxX && rect.y < maxY && rect.x + rect.width > 0 && rect.y + rect.height > 0;
}

function compareMaestroSnapshotMatches(
  left: { node: SnapshotNode; rect: Rect },
  right: { node: SnapshotNode; rect: Rect },
): number {
  const typeRank = maestroTapTargetTypeRank(left.node) - maestroTapTargetTypeRank(right.node);
  if (typeRank !== 0) return typeRank;

  const areaRank = left.rect.width * left.rect.height - right.rect.width * right.rect.height;
  if (areaRank !== 0) return areaRank;

  return (right.node.depth ?? 0) - (left.node.depth ?? 0);
}

function maestroTapTargetTypeRank(node: SnapshotNode): number {
  switch (node.type?.toLowerCase()) {
    case 'button':
    case 'link':
    case 'textfield':
    case 'textview':
    case 'searchfield':
    case 'switch':
    case 'slider':
      return 0;
    case 'cell':
      return 1;
    case 'statictext':
      return 2;
    default:
      return 3;
  }
}

function isDescendantOfSnapshotNode(
  nodes: SnapshotState['nodes'],
  node: SnapshotNode,
  ancestor: SnapshotNode,
): boolean {
  let current: SnapshotNode | undefined = node;
  const byIndex = new Map(nodes.map((candidate) => [candidate.index, candidate]));
  while (typeof current.parentIndex === 'number') {
    current = byIndex.get(current.parentIndex) ?? nodes[current.parentIndex];
    if (!current) return false;
    if (current === ancestor || current.index === ancestor.index) return true;
  }
  return false;
}

function readMaestroTapOnOptions(
  rawOptions: string | undefined,
): { ok: true; value: MaestroTapOnOptions | null } | { ok: false; response: DaemonResponse } {
  if (!rawOptions) return { ok: true, value: null };
  try {
    const value = JSON.parse(rawOptions) as MaestroTapOnOptions;
    return { ok: true, value };
  } catch {
    return {
      ok: false,
      response: errorResponse('INVALID_ARGS', 'tapOn runtime options must be valid JSON.'),
    };
  }
}

function readMaestroSelectorPlatform(flags: ReplayBaseRequest['flags']): Platform {
  return flags?.platform === 'android' ? 'android' : 'ios';
}

function swipeCoordinatesFromTarget(
  target: MaestroSnapshotTarget,
  direction: string,
):
  | { ok: true; start: { x: number; y: number }; end: { x: number; y: number } }
  | { ok: false; response: DaemonResponse } {
  const center = pointInsideRect(target.rect);
  const frame = target.frame;
  const horizontalDistance = swipeDistance(frame?.referenceWidth, target.rect.width);
  const verticalDistance = swipeDistance(frame?.referenceHeight, target.rect.height);
  const minX = 8;
  const minY = 8;
  const maxX = frame ? frame.referenceWidth - 8 : center.x + horizontalDistance;
  const maxY = frame ? frame.referenceHeight - 8 : center.y + verticalDistance;
  switch (direction.toLowerCase()) {
    case 'up':
      return {
        ok: true,
        start: center,
        end: { x: center.x, y: clampCoordinate(center.y - verticalDistance, minY, maxY) },
      };
    case 'down':
      return {
        ok: true,
        start: center,
        end: { x: center.x, y: clampCoordinate(center.y + verticalDistance, minY, maxY) },
      };
    case 'left':
      return {
        ok: true,
        start: center,
        end: { x: clampCoordinate(center.x - horizontalDistance, minX, maxX), y: center.y },
      };
    case 'right':
      return {
        ok: true,
        start: center,
        end: { x: clampCoordinate(center.x + horizontalDistance, minX, maxX), y: center.y },
      };
    default:
      return {
        ok: false,
        response: errorResponse(
          'INVALID_ARGS',
          'swipe.label direction must be up, down, left, or right.',
        ),
      };
  }
}

function swipeDistance(frameSize: number | undefined, rectSize: number): number {
  const screenRelative = typeof frameSize === 'number' ? frameSize * 0.35 : 0;
  return Math.round(Math.min(360, Math.max(120, screenRelative, rectSize * 1.5)));
}

function clampCoordinate(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

function pointInsideRect(rect: Rect): { x: number; y: number } {
  return {
    x: interiorCoordinate(rect.x, rect.width),
    y: interiorCoordinate(rect.y, rect.height),
  };
}

function pointForMaestroTapOnTarget(
  target: MaestroSnapshotTarget,
  selector: string,
): { x: number; y: number } {
  if (!shouldBiasMaestroVisibleTextTap(target.node, selector, target.rect)) {
    return pointInsideRect(target.rect);
  }
  return {
    x: interiorCoordinate(target.rect.x, Math.min(target.rect.width, 168)),
    y: interiorCoordinate(target.rect.y, Math.min(target.rect.height, 48)),
  };
}

function shouldBiasMaestroVisibleTextTap(
  node: SnapshotNode,
  selector: string,
  rect: Rect,
): boolean {
  if (!extractMaestroVisibleTextQuery(selector)) return false;
  if (rect.height < 70 || rect.width < 120) return false;
  const type = node.type?.toLowerCase();
  return type === 'cell' || type === 'other' || type === 'scrollview';
}

function interiorCoordinate(origin: number, size: number): number {
  if (size <= 1) return Math.floor(origin);
  const min = Math.ceil(origin);
  const max = Math.floor(origin + size - 1);
  return clampCoordinate(origin + size / 2, min, max);
}

function invokeMaestroRunScript(params: {
  baseReq: ReplayBaseRequest;
  positionals: string[];
  scope: ReplayVarScope;
}): DaemonResponse {
  const [scriptPath] = params.positionals;
  if (!scriptPath) {
    return errorResponse('INVALID_ARGS', 'runScript requires a file path.');
  }
  try {
    const outputEnv = executeRunScriptFile({
      scriptPath,
      env: {
        ...params.scope.values,
        ...(params.baseReq.flags?.maestro?.runScriptEnv ?? {}),
      },
    });
    return { ok: true, data: { outputEnv } };
  } catch (error) {
    const appError = asAppError(error);
    return errorResponse(appError.code, appError.message, appError.details);
  }
}

async function invokeMaestroRunFlowWhen(params: {
  baseReq: ReplayBaseRequest;
  positionals: string[];
  batchSteps: CommandFlags['batchSteps'] | undefined;
  line: number;
  step: number;
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
  invokeReplayAction: MaestroReplayInvoker;
}): Promise<DaemonResponse> {
  const condition = readMaestroRunFlowWhenCondition(params.positionals);
  if (!condition.ok) return condition.response;
  const conditionResponse = await params.invoke({
    ...params.baseReq,
    command: 'is',
    positionals: [condition.predicate, condition.selector],
    flags: { ...params.baseReq.flags, noRecord: true },
  });
  if (isMaestroWhenConditionMiss(conditionResponse)) {
    return {
      ok: true,
      data: { skipped: true, condition: condition.mode, selector: condition.selector },
    };
  }
  if (!conditionResponse.ok) return conditionResponse;
  return await invokeMaestroRunFlowWhenSteps(params, condition);
}

function readMaestroRunFlowWhenCondition(positionals: string[]): MaestroRunFlowWhenCondition {
  const [mode, selector] = positionals;
  if ((mode !== 'visible' && mode !== 'notVisible') || !selector) {
    return {
      ok: false,
      response: errorResponse(
        'INVALID_ARGS',
        'runFlow.when requires visible/notVisible and a selector.',
      ),
    };
  }
  return {
    ok: true,
    mode,
    predicate: mode === 'visible' ? 'visible' : 'hidden',
    selector,
  };
}

async function invokeMaestroRunFlowWhenSteps(
  params: {
    batchSteps: CommandFlags['batchSteps'] | undefined;
    line: number;
    step: number;
    invokeReplayAction: MaestroReplayInvoker;
  },
  condition: Extract<MaestroRunFlowWhenCondition, { ok: true }>,
): Promise<DaemonResponse> {
  const steps = (params.batchSteps ?? []).map(batchStepToSessionAction);
  for (const [index, action] of steps.entries()) {
    // Preserve stable parent-step ordering for nested runtime commands while
    // keeping the substep distinguishable in traces.
    const response = await params.invokeReplayAction({
      action,
      line: params.line,
      step: params.step + index / 1000,
    });
    if (!response.ok) return response;
  }

  return {
    ok: true,
    data: { ran: steps.length, condition: condition.mode, selector: condition.selector },
  };
}

function isMaestroWhenConditionMiss(response: DaemonResponse): boolean {
  if (response.ok) return response.data?.pass === false;
  const details = response.error.details;
  return (
    details?.command === 'is' &&
    (details.reason === 'selector_not_found' || details.reason === 'predicate_failed')
  );
}

function batchStepToSessionAction(
  step: NonNullable<CommandFlags['batchSteps']>[number],
): SessionAction {
  const action: SessionAction = {
    ts: Date.now(),
    command: step.command,
    positionals: step.positionals ?? [],
    flags: step.flags ?? {},
  };
  if (step.runtime && typeof step.runtime === 'object') {
    action.runtime = step.runtime as SessionAction['runtime'];
  }
  return action;
}

function extractMaestroVisibleTextQuery(selectorExpression: string): string | null {
  const chain = parseSelectorChain(selectorExpression);
  const terms = chain.selectors.flatMap((selector) => selector.terms);
  if (terms.length === 0) return null;
  // Mixed selectors may encode more than a visible-text lookup, so they keep
  // the exact selector path instead of fuzzy text fallback.
  if (!terms.some((term) => term.key === 'label' || term.key === 'text')) return null;
  if (!terms.every((term) => ['label', 'text', 'id'].includes(term.key))) return null;
  const values = terms.map((term) => (typeof term.value === 'string' ? term.value : ''));
  const first = values[0];
  if (!first || !values.every((value) => value === first)) return null;
  return first;
}

function withMaestroScrollTimeoutContext(
  response: FailedDaemonResponse | null,
  selector: string,
  timeoutMs: number,
): DaemonResponse {
  if (!response) {
    return errorResponse(
      'COMMAND_FAILED',
      `scrollUntilVisible timed out after ${timeoutMs}ms for selector: ${selector}`,
    );
  }
  return {
    ok: false,
    error: {
      ...response.error,
      message: `scrollUntilVisible timed out after ${timeoutMs}ms for selector: ${selector}. Last wait: ${response.error.message}`,
    },
  };
}
