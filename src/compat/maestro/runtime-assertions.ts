import { getSnapshotReferenceFrame } from '../../daemon/touch-reference-frame.ts';
import type { DaemonResponse } from '../../daemon/types.ts';
import type { ReplayVarScope } from '../../replay/vars.ts';
import type { SnapshotState } from '../../utils/snapshot.ts';
import { sleep } from '../../utils/timeouts.ts';
import {
  captureMaestroRawSnapshot,
  errorResponse,
  rememberMaestroVisibleContext,
  readSnapshotState,
  type MaestroRuntimeInvoke,
  type ReplayBaseRequest,
} from './runtime-support.ts';
import {
  readMaestroSelectorPlatform,
  resolveVisibleMaestroNodeFromSnapshot,
} from './runtime-targets.ts';

const MAESTRO_ASSERTION_POLICY = {
  animationPollMs: 250,
  assertVisibleGraceMs: 1000,
  assertVisiblePollMs: 250,
  assertNotVisiblePollMs: 250,
  defaultAssertNotVisibleTimeoutMs: 3000,
} as const;

type MaestroVisibilitySample =
  | { visible: true; response: DaemonResponse }
  | { visible: false; response: DaemonResponse; infrastructureFailure: boolean };

export async function invokeMaestroAssertVisible(params: {
  baseReq: ReplayBaseRequest;
  positionals: string[];
  invoke: MaestroRuntimeInvoke;
  scope?: ReplayVarScope;
}): Promise<DaemonResponse> {
  const args = readVisibilityAssertionArgs(params.positionals, {
    command: 'assertVisible',
    defaultTimeoutMs: 5000,
  });
  if (!args.ok) return args.response;

  // Native wait/is cannot replace this loop: wait only proves existence, while
  // is requires unique resolution and does not apply Maestro overlay filtering.
  const startedAt = Date.now();
  const deadlineMs = args.timeoutMs + MAESTRO_ASSERTION_POLICY.assertVisibleGraceMs;
  let lastResponse: DaemonResponse | undefined;
  let capturedAfterDeadline = false;
  while (true) {
    const captureStartedAt = Date.now();
    const sample = await readMaestroVisibilitySample(params, args.selector, 'assertVisible');
    if (sample.visible) return visibleAssertionResponse(sample.response, args.selector, startedAt);
    lastResponse = sample.response;

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= deadlineMs) {
      if (
        shouldCaptureOnceAfterDeadline(
          capturedAfterDeadline,
          captureStartedAt,
          startedAt,
          deadlineMs,
        )
      ) {
        capturedAfterDeadline = true;
        continue;
      }
      break;
    }
    await sleep(MAESTRO_ASSERTION_POLICY.assertVisiblePollMs);
  }

  return (
    lastResponse ??
    errorResponse('COMMAND_FAILED', `Expected visible but did not match: ${args.selector}`, {
      selector: args.selector,
      timeoutMs: args.timeoutMs,
    })
  );
}

function readVisibilityAssertionArgs(
  positionals: string[],
  options: { command: string; defaultTimeoutMs: number },
): { ok: true; selector: string; timeoutMs: number } | { ok: false; response: DaemonResponse } {
  const [selector, timeoutValue = String(options.defaultTimeoutMs)] = positionals;
  if (!selector) {
    return {
      ok: false,
      response: errorResponse('INVALID_ARGS', `${options.command} requires a selector.`),
    };
  }
  const timeoutMs = Number(timeoutValue);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    return {
      ok: false,
      response: errorResponse(
        'INVALID_ARGS',
        `${options.command} timeout must be a non-negative number.`,
      ),
    };
  }
  return { ok: true, selector, timeoutMs };
}

async function readMaestroVisibilitySample(
  params: {
    baseReq: ReplayBaseRequest;
    invoke: MaestroRuntimeInvoke;
    scope?: ReplayVarScope;
  },
  selector: string,
  command: string,
): Promise<MaestroVisibilitySample> {
  const response = await captureMaestroRawSnapshot(params);
  if (!response.ok) return { visible: false, response, infrastructureFailure: true };
  const snapshot = readSnapshotState(response.data);
  if (!snapshot) {
    return {
      visible: false,
      response: errorResponse('COMMAND_FAILED', `Unable to read snapshot data for ${command}.`),
      infrastructureFailure: true,
    };
  }
  const target = resolveVisibleMaestroNodeFromSnapshot(
    snapshot,
    selector,
    readMaestroSelectorPlatform(params.baseReq.flags),
    getSnapshotReferenceFrame(snapshot),
  );
  if (!target.ok) {
    return {
      visible: false,
      response: errorResponse('COMMAND_FAILED', target.message, { selector }),
      infrastructureFailure: false,
    };
  }
  rememberMaestroVisibleContext(params.scope, selector);
  return {
    visible: true,
    response: {
      ok: true,
      data: {
        selector,
        matches: target.matches,
        nodeIndex: target.node.index,
        nodeType: target.node.type,
        nodeLabel: target.node.label,
        nodeIdentifier: target.node.identifier,
        rect: target.rect,
      },
    },
  };
}

function visibleAssertionResponse(
  response: DaemonResponse,
  selector: string,
  startedAt: number,
): DaemonResponse {
  if (!response.ok) return response;
  return {
    ok: true,
    data: {
      selector,
      ...response.data,
      waitedMs: Date.now() - startedAt,
    },
  };
}

function shouldCaptureOnceAfterDeadline(
  capturedAfterDeadline: boolean,
  captureStartedAt: number,
  startedAt: number,
  deadlineMs: number,
): boolean {
  return !capturedAfterDeadline && captureStartedAt - startedAt < deadlineMs;
}

export async function invokeMaestroAssertNotVisible(params: {
  baseReq: ReplayBaseRequest;
  positionals: string[];
  invoke: MaestroRuntimeInvoke;
}): Promise<DaemonResponse> {
  const args = readVisibilityAssertionArgs(params.positionals, {
    command: 'assertNotVisible',
    defaultTimeoutMs: MAESTRO_ASSERTION_POLICY.defaultAssertNotVisibleTimeoutMs,
  });
  if (!args.ok) return args.response;

  // Native is hidden intentionally fails for absent selectors. Maestro
  // assertNotVisible treats absent and overlay-blocked targets as passing, so
  // this loop shares the visible resolver instead of delegating to native is.
  const startedAt = Date.now();
  let hiddenSamples = 0;
  let lastVisibleResponse: DaemonResponse | undefined;
  while (Date.now() - startedAt <= args.timeoutMs) {
    const sample = await readMaestroVisibilitySample(params, args.selector, 'assertNotVisible');
    if (!sample.visible && sample.infrastructureFailure) return sample.response;
    if (sample.visible) {
      hiddenSamples = 0;
      lastVisibleResponse = sample.response;
    } else {
      hiddenSamples += 1;
      const waitedMs = Date.now() - startedAt;
      if (hiddenSamples >= 2 || waitedMs >= args.timeoutMs) {
        return {
          ok: true,
          data: {
            pass: true,
            selector: args.selector,
            stableSamples: hiddenSamples,
            waitedMs,
            timeoutMs: args.timeoutMs,
          },
        };
      }
    }
    await sleep(MAESTRO_ASSERTION_POLICY.assertNotVisiblePollMs);
  }
  if (hiddenSamples > 0) {
    return {
      ok: true,
      data: {
        pass: true,
        selector: args.selector,
        stableSamples: hiddenSamples,
        waitedMs: Date.now() - startedAt,
        timeoutMs: args.timeoutMs,
      },
    };
  }
  return errorResponse('COMMAND_FAILED', `Expected not visible but matched: ${args.selector}`, {
    selector: args.selector,
    timeoutMs: args.timeoutMs,
    lastResponse: lastVisibleResponse,
  });
}

export async function invokeMaestroWaitForAnimationToEnd(params: {
  baseReq: ReplayBaseRequest;
  positionals: string[];
  invoke: MaestroRuntimeInvoke;
}): Promise<DaemonResponse> {
  const timeoutMs = Number(params.positionals[0] ?? 15000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    return errorResponse('INVALID_ARGS', 'waitForAnimationToEnd timeout must be a number.');
  }
  // There is no native wait/is equivalent for "animation has ended"; this is
  // snapshot stability polling by design.
  const startedAt = Date.now();
  let previousSignature: string | undefined;
  let lastResponse: DaemonResponse | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    const response = await captureMaestroRawSnapshot(params);
    const poll = readAnimationPollResult(response, previousSignature, timeoutMs);
    if (poll.done) return poll.response;
    previousSignature = poll.signature ?? previousSignature;
    lastResponse = response;
    await sleep(MAESTRO_ASSERTION_POLICY.animationPollMs);
  }

  return lastResponse?.ok === false
    ? lastResponse
    : { ok: true, data: { stable: false, timeoutMs } };
}

function readAnimationPollResult(
  response: DaemonResponse,
  previousSignature: string | undefined,
  timeoutMs: number,
): { done: true; response: DaemonResponse } | { done: false; signature?: string } {
  const signature = readSnapshotStabilitySignature(response);
  if (!response.ok) return { done: false };
  if (!signature) return { done: true, response };
  if (previousSignature === signature) {
    return { done: true, response: { ok: true, data: { stable: true, timeoutMs } } };
  }
  return { done: false, signature };
}

function readSnapshotStabilitySignature(response: DaemonResponse): string | null {
  if (!response.ok) return null;
  const snapshot = readSnapshotState(response.data);
  return snapshot ? snapshotStabilitySignature(snapshot) : null;
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
