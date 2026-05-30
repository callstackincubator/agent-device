import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { CommandFlags } from '../../../core/dispatch.ts';
import type { DaemonRequest, DaemonResponse, SessionAction } from '../../../daemon/types.ts';
import { invokeMaestroRunFlowWhen } from '../runtime-flow.ts';

test('invokeMaestroRunFlowWhen waits briefly for visible conditions', async () => {
  let snapshots = 0;
  const invokedActions: SessionAction[] = [];
  const batchSteps: CommandFlags['batchSteps'] = [
    { command: 'click', positionals: ['label="Dismiss"'] },
  ];

  const response = await invokeMaestroRunFlowWhen({
    baseReq: {
      token: 't',
      session: 's',
      flags: { platform: 'android' },
    },
    positionals: ['visible', 'label="Dismiss" || text="Dismiss" || id="Dismiss"'],
    batchSteps,
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

test('invokeMaestroRunFlowWhen keeps notVisible conditions immediate', async () => {
  let snapshots = 0;
  const response = await invokeMaestroRunFlowWhen({
    baseReq: {
      token: 't',
      session: 's',
      flags: { platform: 'android' },
    },
    positionals: ['notVisible', 'label="Loading" || text="Loading" || id="Loading"'],
    batchSteps: [{ command: 'click', positionals: ['label="Continue"'] }],
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
