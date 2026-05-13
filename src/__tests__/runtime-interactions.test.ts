import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { AgentDeviceBackend } from '../backend.ts';
import { commands, ref, selector } from '../commands/index.ts';
import { resolveActionableTouchResolution } from '../commands/interaction-targeting.ts';
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

test('runtime click keeps distinct tab button centers when iOS reports the tab bar as hittable', async () => {
  const calls: Point[] = [];
  const device = createInteractionDevice(iosTabBarSnapshot(), {
    tap: async (_context, point) => {
      calls.push(point);
    },
  });

  const refResult = await device.interactions.click(ref('@e4'), {
    session: 'default',
  });
  const selectorResult = await device.interactions.click(selector('label=Settings'), {
    session: 'default',
  });

  assert.deepEqual(calls, [
    { x: 166, y: 822 },
    { x: 257, y: 822 },
  ]);
  assert.equal(refResult.kind, 'ref');
  assert.equal(refResult.node?.label, 'Library');
  assert.equal(selectorResult.kind, 'selector');
  assert.equal(selectorResult.node?.label, 'Settings');
});

test('runtime click keeps non-button semantic targets at their own center', async () => {
  const calls: Point[] = [];
  const device = createInteractionDevice(nonHittableCellSnapshot(), {
    tap: async (_context, point) => {
      calls.push(point);
    },
  });

  const result = await clickRefE2(device);

  assert.deepEqual(calls, [{ x: 70, y: 30 }]);
  assert.equal(result.kind, 'ref');
  assert.equal(result.node?.label, 'Account');
});

test('runtime click still promotes non-touchable nodes to hittable ancestors', async () => {
  const calls: Point[] = [];
  const device = createInteractionDevice(nonTouchableGroupSnapshot(), {
    tap: async (_context, point) => {
      calls.push(point);
    },
  });

  const result = await clickRefE2(device);

  assert.deepEqual(calls, [{ x: 160, y: 60 }]);
  assert.equal(result.kind, 'ref');
  assert.equal(result.node?.label, 'Clickable group');
});

test('touch resolution keeps non-hittable semantic iOS tab buttons at their own center', () => {
  const snapshot = makeSnapshotState([
    {
      index: 0,
      depth: 0,
      type: 'XCUIElementTypeApplication',
      label: 'TabRepro',
      rect: { x: 0, y: 0, width: 402, height: 874 },
    },
    {
      index: 1,
      depth: 1,
      parentIndex: 0,
      type: 'XCUIElementTypeTabBar',
      rect: { x: 0, y: 791, width: 402, height: 83 },
      hittable: true,
    },
    {
      index: 2,
      depth: 2,
      parentIndex: 1,
      type: 'XCUIElementTypeButton',
      label: 'Library',
      rect: { x: 120, y: 800, width: 92, height: 44 },
      hittable: false,
    },
  ]);

  const resolution = resolveActionableTouchResolution(snapshot.nodes, snapshot.nodes[2]!);

  assert.equal(resolution.reason, 'semantic-target');
  assert.equal(resolution.node.label, 'Library');
});

test('touch resolution promotes static text inside a hittable row to the row', () => {
  const snapshot = makeSnapshotState([
    {
      index: 0,
      depth: 0,
      type: 'XCUIElementTypeCell',
      label: 'Account row',
      rect: { x: 10, y: 20, width: 300, height: 60 },
      hittable: true,
    },
    {
      index: 1,
      depth: 1,
      parentIndex: 0,
      type: 'XCUIElementTypeStaticText',
      label: 'Account',
      rect: { x: 24, y: 32, width: 80, height: 20 },
      hittable: false,
    },
  ]);

  const resolution = resolveActionableTouchResolution(snapshot.nodes, snapshot.nodes[1]!);

  assert.equal(resolution.reason, 'hittable-ancestor');
  assert.equal(resolution.node.label, 'Account row');
});

test('touch resolution prefers same-rect hittable descendants over semantic targets', () => {
  const snapshot = makeSnapshotState([
    {
      index: 0,
      depth: 0,
      type: 'XCUIElementTypeButton',
      label: 'Profile',
      rect: { x: 30, y: 40, width: 120, height: 50 },
      hittable: false,
    },
    {
      index: 1,
      depth: 1,
      parentIndex: 0,
      type: 'XCUIElementTypeImage',
      identifier: 'profile-hit-area',
      rect: { x: 30, y: 40, width: 120, height: 50 },
      hittable: true,
    },
  ]);

  const resolution = resolveActionableTouchResolution(snapshot.nodes, snapshot.nodes[0]!);

  assert.equal(resolution.reason, 'same-rect-descendant');
  assert.equal(resolution.node.identifier, 'profile-hit-area');
});

test('touch resolution prevents full-screen window-like ancestors from stealing taps', () => {
  const snapshot = makeSnapshotState([
    {
      index: 0,
      depth: 0,
      type: 'XCUIElementTypeApplication',
      label: 'Example',
      rect: { x: 0, y: 0, width: 390, height: 844 },
      hittable: true,
    },
    {
      index: 1,
      depth: 1,
      parentIndex: 0,
      type: 'XCUIElementTypeStaticText',
      label: 'Status',
      rect: { x: 24, y: 72, width: 80, height: 24 },
      hittable: false,
    },
  ]);

  const resolution = resolveActionableTouchResolution(snapshot.nodes, snapshot.nodes[1]!);

  assert.equal(resolution.reason, 'overly-broad-ancestor');
  assert.equal(resolution.node.label, 'Status');
});

test('touch resolution falls back to the original node when no usable touch target exists', () => {
  const snapshot = makeSnapshotState([
    {
      index: 0,
      depth: 0,
      type: 'XCUIElementTypeOther',
      label: 'Virtual item',
      hittable: false,
    },
  ]);

  const resolution = resolveActionableTouchResolution(snapshot.nodes, snapshot.nodes[0]!);

  assert.equal(resolution.reason, 'original');
  assert.equal(resolution.node.label, 'Virtual item');
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
  await assert.rejects(
    () =>
      desktop.interactions.click(
        { kind: 'point', x: 1, y: 2 },
        { session: 'default', metadata: { surface: 'app' } },
      ),
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

test('runtime focus and longPress share selector/ref target resolution', async () => {
  const calls: unknown[] = [];
  const device = createInteractionDevice(selectorSnapshot(), {
    focus: async (_context, point) => {
      calls.push({ command: 'focus', point });
      return { focused: true };
    },
    longPress: async (_context, point, options) => {
      calls.push({ command: 'longPress', point, durationMs: options?.durationMs });
    },
  });

  const focused = await device.interactions.focus(selector('label=Continue'), {
    session: 'default',
  });
  const longPressed = await device.interactions.longPress(ref('@e1'), {
    session: 'default',
    durationMs: 750,
  });

  assert.equal(focused.kind, 'selector');
  assert.deepEqual(focused.backendResult, { focused: true });
  assert.equal(longPressed.kind, 'ref');
  assert.deepEqual(calls, [
    { command: 'focus', point: { x: 60, y: 40 } },
    { command: 'longPress', point: { x: 60, y: 40 }, durationMs: 750 },
  ]);
});

test('runtime scroll resolves selector targets before calling the backend primitive', async () => {
  const calls: unknown[] = [];
  const device = createInteractionDevice(selectorSnapshot(), {
    scroll: async (_context, target, options) => {
      calls.push({ target, options });
      return { scrolled: true };
    },
  });

  const selectorResult = await device.interactions.scroll({
    session: 'default',
    target: selector('label=Continue'),
    direction: 'down',
    pixels: 120,
  });
  const viewportResult = await device.interactions.scroll({
    direction: 'up',
    amount: 0.5,
  });

  assert.equal(selectorResult.kind, 'selector');
  assert.equal(viewportResult.kind, 'viewport');
  assert.deepEqual(calls, [
    {
      target: { kind: 'point', point: { x: 60, y: 40 } },
      options: { direction: 'down', pixels: 120 },
    },
    {
      target: { kind: 'viewport' },
      options: { direction: 'up', amount: 0.5 },
    },
  ]);
});

test('runtime swipe supports explicit and viewport-derived targets', async () => {
  const calls: unknown[] = [];
  const device = createInteractionDevice(selectorSnapshot(), {
    swipe: async (_context, from, to, options) => {
      calls.push({ from, to, durationMs: options?.durationMs });
    },
  });

  const explicit = await device.interactions.swipe({
    from: selector('label=Continue'),
    to: { x: 200, y: 40 },
    durationMs: 300,
    session: 'default',
  });
  const directional = await device.interactions.swipe({
    direction: 'left',
    distance: 25,
    session: 'default',
  });

  assert.deepEqual(explicit.from, { x: 60, y: 40 });
  assert.deepEqual(directional.from, { x: 60, y: 40 });
  assert.deepEqual(directional.to, { x: 35, y: 40 });
  assert.deepEqual(calls, [
    { from: { x: 60, y: 40 }, to: { x: 200, y: 40 }, durationMs: 300 },
    { from: { x: 60, y: 40 }, to: { x: 35, y: 40 }, durationMs: undefined },
  ]);
});

test('runtime directional swipe uses the visible viewport instead of off-screen content bounds', async () => {
  const calls: unknown[] = [];
  const device = createInteractionDevice(snapshotWithOffscreenContent(), {
    swipe: async (_context, from, to) => {
      calls.push({ from, to });
    },
  });

  const result = await device.interactions.swipe({
    direction: 'left',
    distance: 25,
    session: 'default',
  });

  assert.deepEqual(result.from, { x: 50, y: 50 });
  assert.deepEqual(result.to, { x: 25, y: 50 });
  assert.deepEqual(calls, [{ from: { x: 50, y: 50 }, to: { x: 25, y: 50 } }]);
});

test('runtime viewport gestures reject inspect-only macOS surfaces', async () => {
  for (const surface of ['desktop', 'menubar'] as const) {
    const device = createInteractionDevice(selectorSnapshot(), {
      platform: 'macos',
      sessionMetadata: { surface },
      scroll: async () => {
        throw new Error(`${surface} scroll should be rejected before backend call`);
      },
      swipe: async () => {
        throw new Error(`${surface} swipe should be rejected before backend call`);
      },
      pinch: async () => {
        throw new Error(`${surface} pinch should be rejected before backend call`);
      },
    });

    await assert.rejects(
      () =>
        device.interactions.scroll({
          direction: 'down',
          target: { kind: 'viewport' },
          session: 'default',
        }),
      new RegExp(`scroll is not supported on macOS ${surface}`),
    );
    await assert.rejects(
      () =>
        device.interactions.swipe({
          direction: 'left',
          session: 'default',
        }),
      new RegExp(`swipe is not supported on macOS ${surface}`),
    );
    await assert.rejects(
      () =>
        device.interactions.swipe({
          from: { x: 10, y: 20 },
          to: { x: 30, y: 20 },
          session: 'default',
        }),
      new RegExp(`swipe is not supported on macOS ${surface}`),
    );
    await assert.rejects(
      () =>
        device.interactions.pinch({
          scale: 1.2,
          session: 'default',
        }),
      new RegExp(`pinch is not supported on macOS ${surface}`),
    );
  }
});

test('runtime pinch is backend-gated and resolves optional center targets', async () => {
  const calls: unknown[] = [];
  const unsupported = createInteractionDevice(selectorSnapshot());
  await assert.rejects(
    () => unsupported.interactions.pinch({ scale: 1.2 }),
    /pinch is not supported/,
  );

  const device = createInteractionDevice(selectorSnapshot(), {
    pinch: async (_context, options) => {
      calls.push(options);
    },
  });

  const result = await device.interactions.pinch({
    scale: 0.8,
    center: ref('@e1'),
    session: 'default',
  });

  assert.equal(result.kind, 'pinch');
  assert.deepEqual(result.center, { x: 60, y: 40 });
  assert.deepEqual(calls, [{ scale: 0.8, center: { x: 60, y: 40 } }]);
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

function iosTabBarSnapshot(): SnapshotState {
  return makeSnapshotState([
    {
      index: 0,
      depth: 0,
      type: 'XCUIElementTypeApplication',
      label: 'TabRepro',
      rect: { x: 0, y: 0, width: 402, height: 874 },
      hittable: false,
    },
    {
      index: 1,
      depth: 1,
      parentIndex: 0,
      type: 'XCUIElementTypeTabBar',
      rect: { x: 0, y: 791, width: 402, height: 83 },
      hittable: true,
    },
    {
      index: 2,
      depth: 2,
      parentIndex: 1,
      type: 'XCUIElementTypeButton',
      label: 'Home',
      rect: { x: 30, y: 800, width: 91, height: 44 },
      hittable: false,
    },
    {
      index: 3,
      depth: 2,
      parentIndex: 1,
      type: 'XCUIElementTypeButton',
      label: 'Library',
      rect: { x: 120, y: 800, width: 92, height: 44 },
      hittable: false,
    },
    {
      index: 4,
      depth: 2,
      parentIndex: 1,
      type: 'XCUIElementTypeButton',
      label: 'Settings',
      rect: { x: 211, y: 800, width: 91, height: 44 },
      hittable: false,
    },
    {
      index: 5,
      depth: 2,
      parentIndex: 1,
      type: 'XCUIElementTypeButton',
      label: 'Search',
      rect: { x: 304, y: 800, width: 92, height: 44 },
      hittable: false,
    },
  ]);
}

function nonHittableCellSnapshot(): SnapshotState {
  return makeSnapshotState([
    {
      index: 0,
      depth: 0,
      type: 'XCUIElementTypeOther',
      label: 'Settings list',
      rect: { x: 10, y: 20, width: 300, height: 80 },
      hittable: true,
    },
    {
      index: 1,
      depth: 1,
      parentIndex: 0,
      type: 'XCUIElementTypeCell',
      label: 'Account',
      rect: { x: 20, y: 10, width: 100, height: 40 },
      hittable: false,
    },
  ]);
}

function nonTouchableGroupSnapshot(): SnapshotState {
  return makeSnapshotState([
    {
      index: 0,
      depth: 0,
      type: 'XCUIElementTypeOther',
      label: 'Clickable group',
      rect: { x: 10, y: 20, width: 300, height: 80 },
      hittable: true,
    },
    {
      index: 1,
      depth: 1,
      parentIndex: 0,
      type: 'XCUIElementTypeOther',
      label: 'Decorative group',
      rect: { x: 30, y: 40, width: 60, height: 20 },
      hittable: false,
    },
  ]);
}

function snapshotWithOffscreenContent(): SnapshotState {
  return makeSnapshotState([
    {
      index: 0,
      depth: 0,
      type: 'Application',
      label: 'Example',
      rect: { x: 0, y: 0, width: 100, height: 100 },
    },
    {
      index: 1,
      depth: 1,
      parentIndex: 0,
      type: 'Button',
      label: 'Visible',
      rect: { x: 10, y: 10, width: 20, height: 20 },
      hittable: true,
    },
    {
      index: 2,
      depth: 1,
      parentIndex: 0,
      type: 'Button',
      label: 'Offscreen',
      rect: { x: 10, y: 900, width: 20, height: 20 },
      hittable: true,
    },
  ]);
}

function createInteractionDevice(
  snapshot: SnapshotState,
  overrides: Partial<
    Pick<
      AgentDeviceBackend,
      | 'captureSnapshot'
      | 'tap'
      | 'fill'
      | 'typeText'
      | 'focus'
      | 'longPress'
      | 'scroll'
      | 'swipe'
      | 'pinch'
    >
  > & {
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
      focus: overrides.focus ? async (...args) => await overrides.focus?.(...args) : undefined,
      longPress: overrides.longPress
        ? async (...args) => await overrides.longPress?.(...args)
        : undefined,
      scroll: overrides.scroll ? async (...args) => await overrides.scroll?.(...args) : undefined,
      swipe: overrides.swipe ? async (...args) => await overrides.swipe?.(...args) : undefined,
      pinch: overrides.pinch ? async (...args) => await overrides.pinch?.(...args) : undefined,
    } satisfies AgentDeviceBackend,
    artifacts: createLocalArtifactAdapter(),
    sessions: createMemorySessionStore([
      { name: 'default', snapshot, metadata: overrides.sessionMetadata },
    ]),
    policy: localCommandPolicy(),
  });
}

async function clickRefE2(device: ReturnType<typeof createInteractionDevice>) {
  return await device.interactions.click(ref('@e2'), {
    session: 'default',
  });
}
