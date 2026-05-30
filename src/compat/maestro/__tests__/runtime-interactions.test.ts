import { expect, test } from 'vitest';
import type { DaemonRequest, DaemonResponse } from '../../../daemon/types.ts';
import type { SnapshotState } from '../../../utils/snapshot.ts';
import {
  invokeMaestroSwipeScreen,
  invokeMaestroTapOn,
  invokeMaestroTapPointPercent,
} from '../runtime-interactions.ts';

test('invokeMaestroTapOn resolves mutating taps from the current raw snapshot', async () => {
  const selector =
    'label="Article by Gandalf" || text="Article by Gandalf" || id="Article by Gandalf"';

  const clicks: string[][] = [];
  let snapshots = 0;
  const response = await invokeMaestroTapOn({
    baseReq: {
      token: 'test',
      session: 'nav',
      flags: { platform: 'ios' },
    },
    positionals: [selector],
    invoke: async (req: DaemonRequest): Promise<DaemonResponse> => {
      if (req.command === 'snapshot') {
        snapshots += 1;
        return { ok: true, data: currentBreadcrumbSnapshot() };
      }
      if (req.command === 'click') {
        clicks.push(req.positionals ?? []);
        return { ok: true, data: {} };
      }
      return { ok: false, error: { code: 'UNEXPECTED_COMMAND', message: req.command } };
    },
  });

  expect(response.ok).toBe(true);
  expect(snapshots).toBe(1);
  expect(clicks).toEqual([['86', '89']]);
});

test('invokeMaestroSwipeScreen maps horizontal directional swipes to native gesture presets', async () => {
  const gestures: string[][] = [];
  const response = await invokeMaestroSwipeScreen({
    baseReq: {
      token: 'test',
      session: 'pager',
      flags: { platform: 'android' },
    },
    positionals: ['direction', 'left', '300'],
    invoke: async (req: DaemonRequest): Promise<DaemonResponse> => {
      if (req.command === 'gesture') {
        gestures.push(req.positionals ?? []);
        return { ok: true, data: {} };
      }
      return { ok: false, error: { code: 'UNEXPECTED_COMMAND', message: req.command } };
    },
  });

  expect(response.ok).toBe(true);
  expect(gestures).toEqual([['swipe', 'left', '300']]);
});

test('invokeMaestroSwipeScreen mirrors horizontal directional swipe presets', async () => {
  const gestures: string[][] = [];
  const response = await invokeMaestroSwipeScreen({
    baseReq: {
      token: 'test',
      session: 'pager',
      flags: { platform: 'android' },
    },
    positionals: ['direction', 'right', '300'],
    invoke: async (req: DaemonRequest): Promise<DaemonResponse> => {
      if (req.command === 'gesture') {
        gestures.push(req.positionals ?? []);
        return { ok: true, data: {} };
      }
      return { ok: false, error: { code: 'UNEXPECTED_COMMAND', message: req.command } };
    },
  });

  expect(response.ok).toBe(true);
  expect(gestures).toEqual([['swipe', 'right', '300']]);
});

test('invokeMaestroSwipeScreen preserves vertical percentage endpoints', async () => {
  const swipes: string[][] = [];
  const response = await invokeMaestroSwipeScreen({
    baseReq: {
      token: 'test',
      session: 'article',
      flags: { platform: 'ios' },
    },
    positionals: ['percent', '50', '75', '50', '35', '300'],
    invoke: async (req: DaemonRequest): Promise<DaemonResponse> => {
      if (req.command === 'snapshot') {
        return { ok: true, data: fullScreenSnapshot(400, 800) };
      }
      if (req.command === 'swipe') {
        swipes.push(req.positionals ?? []);
        return { ok: true, data: {} };
      }
      return { ok: false, error: { code: 'UNEXPECTED_COMMAND', message: req.command } };
    },
  });

  expect(response.ok).toBe(true);
  expect(swipes).toEqual([['200', '600', '200', '280', '300']]);
});

test('invokeMaestroSwipeScreen keeps Android horizontal percentage swipes on the content lane', async () => {
  const swipes: string[][] = [];
  const response = await invokeMaestroSwipeScreen({
    baseReq: {
      token: 'test',
      session: 'pager',
      flags: { platform: 'android' },
    },
    positionals: ['percent', '90', '50', '10', '50', '300'],
    invoke: async (req: DaemonRequest): Promise<DaemonResponse> => {
      if (req.command === 'snapshot') {
        return { ok: true, data: fullScreenSnapshot(390, 600) };
      }
      if (req.command === 'swipe') {
        swipes.push(req.positionals ?? []);
        return { ok: true, data: {} };
      }
      return { ok: false, error: { code: 'UNEXPECTED_COMMAND', message: req.command } };
    },
  });

  expect(response.ok).toBe(true);
  expect(swipes).toEqual([['351', '390', '39', '390', '300']]);
});

test('invokeMaestroTapPointPercent shares percentage point geometry without clamping', async () => {
  const clicks: string[][] = [];
  const response = await invokeMaestroTapPointPercent({
    baseReq: {
      token: 'test',
      session: 'article',
      flags: { platform: 'ios' },
    },
    positionals: ['125', '-10'],
    invoke: async (req: DaemonRequest): Promise<DaemonResponse> => {
      if (req.command === 'snapshot') {
        return { ok: true, data: fullScreenSnapshot(400, 800) };
      }
      if (req.command === 'click') {
        clicks.push(req.positionals ?? []);
        return { ok: true, data: {} };
      }
      return { ok: false, error: { code: 'UNEXPECTED_COMMAND', message: req.command } };
    },
  });

  expect(response.ok).toBe(true);
  expect(clicks).toEqual([['500', '-80']]);
});

function currentBreadcrumbSnapshot(): SnapshotState {
  return {
    createdAt: Date.now(),
    nodes: [
      appNode(),
      windowNode(),
      {
        index: 2,
        ref: 'e3',
        type: 'ScrollView',
        label: 'Article by Gandalf',
        depth: 4,
        parentIndex: 1,
        rect: { x: 0, y: 58.33333333333333, width: 402, height: 58.33333333333333 },
      },
      {
        index: 3,
        ref: 'e4',
        type: 'Cell',
        label: 'Article by Gandalf',
        depth: 5,
        parentIndex: 2,
        rect: { x: 8, y: 65.33333587646484, width: 155, height: 48 },
      },
    ],
  };
}

function fullScreenSnapshot(width: number, height: number): SnapshotState {
  return {
    createdAt: Date.now(),
    nodes: [
      {
        index: 0,
        ref: 'e1',
        type: 'Application',
        label: 'Android Test App',
        depth: 0,
        rect: { x: 0, y: 0, width, height },
      },
      {
        index: 1,
        ref: 'e2',
        type: 'Window',
        depth: 1,
        parentIndex: 0,
        rect: { x: 0, y: 0, width, height },
      },
    ],
  };
}

function appNode(): SnapshotState['nodes'][number] {
  return {
    index: 0,
    ref: 'e1',
    type: 'Application',
    label: 'React Navigation Example',
    depth: 0,
    rect: { x: 0, y: 0, width: 402, height: 874 },
  };
}

function windowNode(): SnapshotState['nodes'][number] {
  return {
    index: 1,
    ref: 'e2',
    type: 'Window',
    depth: 1,
    parentIndex: 0,
    rect: { x: 0, y: 0, width: 402, height: 874 },
  };
}
