import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { AgentDeviceBackend } from '../backend.ts';
import { commands, ref, selector } from '../commands/index.ts';
import { createLocalArtifactAdapter } from '../io.ts';
import { createAgentDevice, createMemorySessionStore, localCommandPolicy } from '../runtime.ts';
import type { Point, SnapshotState } from '../utils/snapshot.ts';
import { makeSnapshotState } from './test-utils/index.ts';

test('runtime click taps an explicit point without requiring a snapshot', async () => {
  const calls: Array<{ point: Point; count?: number }> = [];
  const device = createInteractionDevice(selectorSnapshot(), {
    tap: async (_context, point, options) => {
      calls.push({ point, count: options?.count });
    },
  });

  const result = await device.interactions.click({ kind: 'point', x: 10, y: 20 }, { count: 2 });

  assert.deepEqual(calls, [{ point: { x: 10, y: 20 }, count: 2 }]);
  assert.deepEqual(result, { kind: 'point', point: { x: 10, y: 20 } });
});

test('runtime interactions pass runtime signal to backend primitives', async () => {
  const controller = new AbortController();
  let signal: AbortSignal | undefined;
  const device = createAgentDevice({
    backend: {
      platform: 'ios',
      tap: async (context) => {
        signal = context.signal;
      },
      typeText: async () => {},
    } satisfies AgentDeviceBackend,
    artifacts: createLocalArtifactAdapter(),
    policy: localCommandPolicy(),
    signal: controller.signal,
  });

  await device.interactions.click({ kind: 'point', x: 1, y: 2 });

  assert.equal(signal, controller.signal);
});

test('runtime press resolves selector targets to the actionable node center', async () => {
  const calls: Point[] = [];
  const device = createInteractionDevice(selectorSnapshot(), {
    tap: async (_context, point) => {
      calls.push(point);
      return { ok: true };
    },
  });

  const result = await device.interactions.press(selector('label=Continue'), {
    session: 'default',
  });

  assert.deepEqual(calls, [{ x: 60, y: 40 }]);
  assert.equal(result.kind, 'selector');
  assert.deepEqual(result.target, { kind: 'selector', selector: 'label=Continue' });
  assert.equal(result.node?.label, 'Continue');
  assert.deepEqual(result.selectorChain, [
    'role="button" label="Continue"',
    'label="Continue"',
    'value="Continue"',
  ]);
  assert.deepEqual(result.backendResult, { ok: true });
});

test('runtime fill resolves refs and forwards text to the backend primitive', async () => {
  const calls: Array<{ point: Point; text: string; delayMs?: number }> = [];
  const device = createInteractionDevice(fillableSnapshot(), {
    captureSnapshot: async () => {
      throw new Error('ref fill should use the stored session snapshot');
    },
    fill: async (_context, point, text, options) => {
      calls.push({ point, text, delayMs: options?.delayMs });
    },
  });

  const result = await device.interactions.fill(ref('@e1'), 'hello', {
    session: 'default',
    delayMs: 25,
  });

  assert.deepEqual(calls, [{ point: { x: 50, y: 30 }, text: 'hello', delayMs: 25 }]);
  assert.equal(result.kind, 'ref');
  assert.deepEqual(result.target, { kind: 'ref', ref: '@e1' });
  assert.equal(result.text, 'hello');
  assert.equal(result.warning, undefined);
});

test('runtime interactions reject unsupported macOS desktop and menubar surfaces', async () => {
  const desktop = createInteractionDevice(selectorSnapshot(), {
    platform: 'macos',
    sessionMetadata: { surface: 'desktop' },
    tap: async () => {
      throw new Error('desktop click should be rejected before backend tap');
    },
  });
  await assert.rejects(
    () => desktop.interactions.click({ kind: 'point', x: 1, y: 2 }, { session: 'default' }),
    /click is not supported on macOS desktop sessions yet/,
  );

  const menubar = createInteractionDevice(fillableSnapshot(), {
    platform: 'macos',
    sessionMetadata: { surface: 'menubar' },
    fill: async () => {
      throw new Error('menubar fill should be rejected before backend fill');
    },
  });
  await assert.rejects(
    () => menubar.interactions.fill(ref('@e1'), 'hello', { session: 'default' }),
    /fill is not supported on macOS menubar sessions yet/,
  );

  let pressed = false;
  const menubarPress = createInteractionDevice(fillableSnapshot(), {
    platform: 'macos',
    sessionMetadata: { surface: 'menubar' },
    tap: async () => {
      pressed = true;
    },
  });

  await menubarPress.interactions.press(ref('@e1'), { session: 'default' });

  assert.equal(pressed, true);
});

test('runtime ref interactions refresh the snapshot when a stored ref has no usable rect', async () => {
  const staleSnapshot = makeSnapshotState([
    {
      index: 0,
      depth: 0,
      type: 'Button',
      label: 'Continue',
      hittable: true,
    },
  ]);
  const freshSnapshot = selectorSnapshot();
  const calls: Point[] = [];
  let captures = 0;
  const device = createInteractionDevice(staleSnapshot, {
    captureSnapshot: async () => {
      captures += 1;
      return { snapshot: freshSnapshot };
    },
    tap: async (_context, point) => {
      calls.push(point);
    },
  });

  const result = await device.interactions.click(ref('@e1'), { session: 'default' });

  assert.equal(captures, 1);
  assert.deepEqual(calls, [{ x: 60, y: 40 }]);
  assert.equal(result.kind, 'ref');
  assert.equal(result.node?.rect?.width, 100);
});

test('runtime typeText validates refs and forwards text to the backend primitive', async () => {
  const calls: Array<{ text: string; delayMs?: number }> = [];
  const device = createInteractionDevice(selectorSnapshot(), {
    typeText: async (_context, text, options) => {
      calls.push({ text, delayMs: options?.delayMs });
    },
  });

  const result = await device.interactions.typeText('hello', {
    session: 'default',
    delayMs: 25,
  });

  assert.deepEqual(calls, [{ text: 'hello', delayMs: 25 }]);
  assert.equal(result.kind, 'text');
  assert.equal(result.text, 'hello');
  assert.equal(result.delayMs, 25);
  assert.equal(result.message, 'Typed 5 chars');

  await assert.rejects(
    () => device.interactions.typeText('@e1 hello', { session: 'default' }),
    /type does not accept a target ref/,
  );
});

test('runtime interaction commands are available from the command namespace', async () => {
  const device = createInteractionDevice(selectorSnapshot(), {
    tap: async () => {},
  });

  const result = await commands.interactions.click(device, {
    session: 'default',
    target: selector('label=Continue'),
  });

  assert.equal(result.kind, 'selector');
});

function selectorSnapshot(): SnapshotState {
  return makeSnapshotState([
    {
      index: 0,
      depth: 0,
      type: 'Button',
      label: 'Continue',
      value: 'Continue',
      rect: { x: 10, y: 20, width: 100, height: 40 },
      hittable: true,
    },
  ]);
}

function fillableSnapshot(): SnapshotState {
  return makeSnapshotState([
    {
      index: 0,
      depth: 0,
      type: 'XCUIElementTypeTextField',
      label: 'Email',
      rect: { x: 20, y: 10, width: 60, height: 40 },
      hittable: true,
    },
  ]);
}

function createInteractionDevice(
  snapshot: SnapshotState,
  overrides: Partial<Pick<AgentDeviceBackend, 'captureSnapshot' | 'tap' | 'fill' | 'typeText'>> & {
    platform?: AgentDeviceBackend['platform'];
    sessionMetadata?: Record<string, unknown>;
  } = {},
) {
  return createAgentDevice({
    backend: {
      platform: overrides.platform ?? 'ios',
      captureSnapshot: async (...args) =>
        overrides.captureSnapshot ? await overrides.captureSnapshot(...args) : { snapshot },
      tap: async (...args) => await overrides.tap?.(...args),
      fill: async (...args) => await overrides.fill?.(...args),
      typeText: async (...args) => await overrides.typeText?.(...args),
    } satisfies AgentDeviceBackend,
    artifacts: createLocalArtifactAdapter(),
    sessions: createMemorySessionStore([
      { name: 'default', snapshot, metadata: overrides.sessionMetadata },
    ]),
    policy: localCommandPolicy(),
  });
}
