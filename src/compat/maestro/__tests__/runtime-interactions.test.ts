import { expect, test } from 'vitest';
import type { DaemonRequest, DaemonResponse } from '../../../daemon/types.ts';
import type { SnapshotState } from '../../../utils/snapshot.ts';
import { invokeMaestroSwipeScreen, invokeMaestroTapOn } from '../runtime-interactions.ts';

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

test('invokeMaestroSwipeScreen uses an Android content-lane directional swipe', async () => {
  const swipes: string[][] = [];
  const response = await invokeMaestroSwipeScreen({
    baseReq: {
      token: 'test',
      session: 'pager',
      flags: { platform: 'android' },
    },
    positionals: ['direction', 'left', '300'],
    invoke: async (req: DaemonRequest): Promise<DaemonResponse> => {
      if (req.command === 'snapshot') {
        return { ok: true, data: fullScreenSnapshot(1080, 2340) };
      }
      if (req.command === 'swipe') {
        swipes.push(req.positionals ?? []);
        return { ok: true, data: {} };
      }
      return { ok: false, error: { code: 'UNEXPECTED_COMMAND', message: req.command } };
    },
  });

  expect(response.ok).toBe(true);
  expect(swipes).toEqual([['864', '1521', '216', '1521', '300']]);
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
