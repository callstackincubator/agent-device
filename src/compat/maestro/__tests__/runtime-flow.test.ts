import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { DaemonRequest, DaemonResponse, SessionAction } from '../../../daemon/types.ts';
import { invokeMaestroRunFlowWhenControl } from '../runtime-flow.ts';

test('invokeMaestroRunFlowWhenControl waits briefly for visible conditions', async () => {
  let snapshots = 0;
  const invokedActions: SessionAction[] = [];
  const actions: SessionAction[] = [
    { ts: Date.now(), command: 'click', positionals: ['label="Dismiss"'], flags: {} },
  ];

  const response = await invokeMaestroRunFlowWhenControl({
    baseReq: {
      token: 't',
      session: 's',
      flags: { platform: 'android' },
    },
    control: {
      kind: 'maestroRunFlowWhen',
      mode: 'visible',
      selector: 'label="Dismiss" || text="Dismiss" || id="Dismiss"',
      actions,
    },
    line: 12,
    step: 4,
    invoke: async (req: DaemonRequest): Promise<DaemonResponse> => {
      assert.equal(req.command, 'snapshot');
      snapshots += 1;
      return {
        ok: true,
        data: {
          createdAt: Date.now(),
          nodes:
            snapshots === 1
              ? []
              : [
                  {
                    index: 1,
                    ref: 'e1',
                    type: 'android.widget.TextView',
                    label: 'Dismiss',
                    rect: { x: 201, y: 2180, width: 138, height: 55 },
                    depth: 20,
                  },
                ],
        },
      };
    },
    invokeReplayAction: async ({ action }): Promise<DaemonResponse> => {
      invokedActions.push(action);
      return { ok: true, data: { clicked: true } };
    },
  });

  assert.equal(response.ok, true);
  assert.equal(snapshots, 2);
  assert.deepEqual(
    invokedActions.map((action) => [action.command, action.positionals]),
    [['click', ['label="Dismiss"']]],
  );
  if (response.ok) {
    assert.equal(response.data?.ran, 1);
  }
});

test('invokeMaestroRunFlowWhenControl falls back to raw iOS snapshots after optimized miss', async () => {
  const snapshotFlags: Array<DaemonRequest['flags']> = [];
  const invokedActions: SessionAction[] = [];
  const actions: SessionAction[] = [
    { ts: Date.now(), command: 'click', positionals: ['label="Continue"'], flags: {} },
  ];

  const response = await invokeMaestroRunFlowWhenControl({
    baseReq: {
      token: 't',
      session: 's',
      flags: { platform: 'ios' },
    },
    control: {
      kind: 'maestroRunFlowWhen',
      mode: 'visible',
      selector: 'label="Continue" || text="Continue" || id="Continue"',
      actions,
    },
    line: 12,
    step: 4,
    invoke: async (req: DaemonRequest): Promise<DaemonResponse> => {
      assert.equal(req.command, 'snapshot');
      snapshotFlags.push(req.flags);
      const isRaw = req.flags?.snapshotRaw === true;
      return {
        ok: true,
        data: {
          createdAt: Date.now(),
          nodes: isRaw
            ? [
                {
                  index: 1,
                  ref: 'e1',
                  type: 'Button',
                  label: 'Continue',
                  rect: { x: 100, y: 420, width: 120, height: 44 },
                  depth: 4,
                },
              ]
            : [],
        },
      };
    },
    invokeReplayAction: async ({ action }): Promise<DaemonResponse> => {
      invokedActions.push(action);
      return { ok: true, data: { clicked: true } };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(snapshotFlags.map((flags) => flags?.snapshotRaw), [undefined, true]);
  assert.deepEqual(
    invokedActions.map((action) => [action.command, action.positionals]),
    [['click', ['label="Continue"']]],
  );
});

test('invokeMaestroRunFlowWhenControl keeps notVisible conditions immediate', async () => {
  let snapshots = 0;
  const response = await invokeMaestroRunFlowWhenControl({
    baseReq: {
      token: 't',
      session: 's',
      flags: { platform: 'android' },
    },
    control: {
      kind: 'maestroRunFlowWhen',
      mode: 'notVisible',
      selector: 'label="Loading" || text="Loading" || id="Loading"',
      actions: [{ ts: Date.now(), command: 'click', positionals: ['label="Continue"'], flags: {} }],
    },
    line: 14,
    step: 7,
    invoke: async (): Promise<DaemonResponse> => {
      snapshots += 1;
      return {
        ok: true,
        data: {
          createdAt: Date.now(),
          nodes: [
            {
              index: 1,
              ref: 'e1',
              type: 'android.widget.TextView',
              label: 'Loading',
              rect: { x: 120, y: 420, width: 160, height: 48 },
              depth: 8,
            },
          ],
        },
      };
    },
    invokeReplayAction: async (): Promise<DaemonResponse> => {
      throw new Error('notVisible should skip while the selector is visible');
    },
  });

  assert.equal(response.ok, true);
  assert.equal(snapshots, 1);
  if (response.ok) {
    assert.equal(response.data?.skipped, true);
  }
});
