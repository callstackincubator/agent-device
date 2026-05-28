import { getSnapshotReferenceFrame } from '../../daemon/touch-reference-frame.ts';
import type { DaemonResponse } from '../../daemon/types.ts';
import type { ReplayVarScope } from '../../replay/vars.ts';
import type { SnapshotState } from '../../utils/snapshot.ts';
import { sleep } from '../../utils/timeouts.ts';
import {
  captureMaestroRawSnapshot,
  errorResponse,
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
  assertNotVisibleTimeoutMs: 3000,
} as const;

export async function invokeMaestroAssertVisible(params: {
  baseReq: ReplayBaseRequest;
  positionals: string[];
  invoke: MaestroRuntimeInvoke;
  scope?: ReplayVarScope;
}): Promise<DaemonResponse> {
  const [selector, timeoutValue = '5000'] = params.positionals;
  if (!selector) {
    return errorResponse('INVALID_ARGS', 'assertVisible requires a selector.');
  }
  const timeoutMs = Number(timeoutValue);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    return errorResponse('INVALID_ARGS', 'assertVisible timeout must be a non-negative number.');
  }

  const startedAt = Date.now();
  const deadlineMs = timeoutMs + MAESTRO_ASSERTION_POLICY.assertVisibleGraceMs;
  let lastResponse: DaemonResponse | undefined;
  do {
    const response = await captureMaestroRawSnapshot(params);
    lastResponse = response;
    if (response.ok) {
      const snapshot = readSnapshotState(response.data);
      if (!snapshot) {
        return errorResponse('COMMAND_FAILED', 'Unable to read snapshot data for assertVisible.');
      }
      const target = resolveVisibleMaestroNodeFromSnapshot(
        snapshot,
        selector,
        readMaestroSelectorPlatform(params.baseReq.flags),
        getSnapshotReferenceFrame(snapshot),
      );
      if (target.ok) {
        return {
          ok: true,
          data: {
            selector,
            matches: target.matches,
            nodeIndex: target.node.index,
            nodeType: target.node.type,
            nodeLabel: target.node.label,
            nodeIdentifier: target.node.identifier,
            rect: target.rect,
            waitedMs: Date.now() - startedAt,
          },
        };
      }
      lastResponse = errorResponse('COMMAND_FAILED', target.message, { selector });
    }

    if (Date.now() - startedAt >= deadlineMs) break;
    await sleep(MAESTRO_ASSERTION_POLICY.assertVisiblePollMs);
  } while (Date.now() - startedAt <= deadlineMs);

  return (
    lastResponse ??
    errorResponse('COMMAND_FAILED', `Expected visible but did not match: ${selector}`, {
      selector,
      timeoutMs,
    })
  );
}

export async function invokeMaestroAssertNotVisible(params: {
  baseReq: ReplayBaseRequest;
  positionals: string[];
  invoke: MaestroRuntimeInvoke;
}): Promise<DaemonResponse> {
  const [selector] = params.positionals;
  if (!selector) {
    return errorResponse('INVALID_ARGS', 'assertNotVisible requires a selector.');
  }
  const startedAt = Date.now();
  let hiddenSamples = 0;
  let lastVisibleResponse: DaemonResponse | undefined;
  while (Date.now() - startedAt <= MAESTRO_ASSERTION_POLICY.assertNotVisibleTimeoutMs) {
    const response = await params.invoke({
      ...params.baseReq,
      command: 'is',
      positionals: ['visible', selector],
      flags: { ...params.baseReq.flags, noRecord: true },
    });
    if (response.ok) {
      hiddenSamples = 0;
      lastVisibleResponse = response;
    } else if (isMaestroVisibilityMiss(response)) {
      hiddenSamples += 1;
      if (hiddenSamples >= 2) {
        return {
          ok: true,
          data: {
            pass: true,
            selector,
            stableSamples: hiddenSamples,
            timeoutMs: MAESTRO_ASSERTION_POLICY.assertNotVisibleTimeoutMs,
          },
        };
      }
    } else {
      return response;
    }
    await sleep(MAESTRO_ASSERTION_POLICY.assertNotVisiblePollMs);
  }
  return errorResponse('COMMAND_FAILED', `Expected not visible but matched: ${selector}`, {
    selector,
    timeoutMs: MAESTRO_ASSERTION_POLICY.assertNotVisibleTimeoutMs,
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

function isMaestroVisibilityMiss(response: Extract<DaemonResponse, { ok: false }>): boolean {
  const details = response.error.details;
  return (
    details?.command === 'is' &&
    (details.reason === 'selector_not_found' || details.reason === 'predicate_failed')
  );
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
