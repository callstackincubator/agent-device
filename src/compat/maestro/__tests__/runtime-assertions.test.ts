import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import {
  invokeMaestroAssertNotVisible,
  invokeMaestroAssertVisible,
} from '../runtime-assertions.ts';
import type { DaemonRequest, DaemonResponse } from '../../../daemon/types.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

test('invokeMaestroAssertVisible takes a terminal snapshot when the last miss started before the deadline', async () => {
  vi.spyOn(Date, 'now')
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(1000)
    .mockReturnValueOnce(6500)
    .mockReturnValueOnce(6500)
    .mockReturnValueOnce(6600);

  let snapshots = 0;
  const response = await invokeMaestroAssertVisible({
    baseReq: {
      token: 't',
      session: 's',
      flags: { platform: 'android' },
    },
    positionals: ['label="Details is preloaded!"', '5000'],
    invoke: async (): Promise<DaemonResponse> => {
      snapshots += 1;
      if (snapshots === 1) {
        return { ok: true, data: { createdAt: 1, nodes: [] } };
      }
      return {
        ok: true,
        data: {
          createdAt: 2,
          nodes: [
            {
              index: 1,
              ref: 'e1',
              type: 'android.widget.TextView',
              label: 'Details is preloaded!',
              rect: { x: 120, y: 900, width: 300, height: 60 },
              depth: 8,
            },
          ],
        },
      };
    },
  });

  assert.equal(response.ok, true);
  assert.equal(snapshots, 2);
  if (response.ok) {
    assert.ok(response.data);
    assert.equal(response.data.nodeLabel, 'Details is preloaded!');
    assert.equal(response.data.waitedMs, 6600);
  }
});

test('invokeMaestroAssertNotVisible passes after a slow hidden sample exhausts the timeout', async () => {
  vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(3500);

  const calls: DaemonRequest[] = [];
  const response = await invokeMaestroAssertNotVisible({
    baseReq: {
      token: 't',
      session: 's',
      flags: {},
    },
    positionals: ['id="tab-4"'],
    invoke: async (req): Promise<DaemonResponse> => {
      calls.push(req);
      return {
        ok: true,
        data: {
          createdAt: 1,
          nodes: [],
        },
      };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.positionals]),
    [['snapshot', []]],
  );
  if (response.ok) {
    assert.ok(response.data);
    assert.equal(response.data.stableSamples, 1);
    assert.equal(response.data.waitedMs, 3500);
  }
});

test('invokeMaestroAssertNotVisible ignores matched nodes without visible rects', async () => {
  vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(3500);

  const response = await invokeMaestroAssertNotVisible({
    baseReq: {
      token: 't',
      session: 's',
      flags: { platform: 'android' },
    },
    positionals: ['label="📌" || text="📌" || id="📌"'],
    invoke: async (): Promise<DaemonResponse> => ({
      ok: true,
      data: {
        createdAt: 1,
        nodes: [
          {
            index: 1,
            ref: 'e1',
            type: 'android.widget.TextView',
            label: '📌',
            value: '📌',
            enabled: true,
            depth: 21,
          },
        ],
      },
    }),
  });

  assert.equal(response.ok, true);
  if (response.ok) {
    assert.ok(response.data);
    assert.equal(response.data.stableSamples, 1);
  }
});

test('invokeMaestroAssertNotVisible accepts timeout overrides for short extended waits', async () => {
  vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(300);

  const response = await invokeMaestroAssertNotVisible({
    baseReq: {
      token: 't',
      session: 's',
      flags: {},
    },
    positionals: ['id="toast"', '1'],
    invoke: async (): Promise<DaemonResponse> => ({
      ok: true,
      data: {
        createdAt: 1,
        nodes: [],
      },
    }),
  });

  assert.equal(response.ok, true);
  if (response.ok) {
    assert.ok(response.data);
    assert.equal(response.data.stableSamples, 1);
    assert.equal(response.data.timeoutMs, 1);
  }
});
