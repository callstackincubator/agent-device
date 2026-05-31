import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import {
  invokeMaestroAssertNotVisible,
  invokeMaestroAssertVisible,
} from '../runtime-assertions.ts';
import type { DaemonRequest, DaemonResponse } from '../../../daemon/types.ts';
import type { SnapshotState } from '../../../utils/snapshot.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
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
          nodes: [node('Details is preloaded!')],
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

test('invokeMaestroAssertVisible retries transient snapshot failures until a later match', async () => {
  vi.useFakeTimers();

  let snapshots = 0;
  const responsePromise = invokeMaestroAssertVisible({
    baseReq: {
      token: 't',
      session: 's',
      flags: { platform: 'android' },
    },
    positionals: ['label="Ready"', '1000'],
    invoke: async (): Promise<DaemonResponse> => {
      snapshots += 1;
      if (snapshots === 1) {
        return {
          ok: false,
          error: { code: 'SNAPSHOT_FAILED', message: 'Snapshot temporarily unavailable.' },
        };
      }
      return {
        ok: true,
        data: {
          createdAt: 2,
          nodes: [node('Ready')],
        },
      };
    },
  });

  await vi.advanceTimersByTimeAsync(250);
  const response = await responsePromise;

  assert.equal(response.ok, true);
  assert.equal(snapshots, 2);
  if (response.ok) {
    assert.ok(response.data);
    assert.equal(response.data.nodeLabel, 'Ready');
    assert.equal(response.data.waitedMs, 250);
  }
});

test('invokeMaestroAssertVisible dismisses React Native overlays before retrying native iOS wait', async () => {
  const calls: Array<[string, string[] | undefined]> = [];
  let waits = 0;
  const response = await invokeMaestroAssertVisible({
    baseReq: {
      token: 't',
      session: 's',
      flags: { platform: 'ios' },
    },
    positionals: ['label="Ready" || text="Ready" || id="Ready"', '60000'],
    invoke: async (req): Promise<DaemonResponse> => {
      calls.push([req.command, req.positionals]);
      if (req.command === 'wait') {
        waits += 1;
        if (waits === 1) {
          return {
            ok: false,
            error: {
              code: 'COMMAND_FAILED',
              message: 'wait timed out for text: Ready. Current surface: Uncaught error',
            },
          };
        }
        return { ok: true, data: { matches: 1 } };
      }
      if (req.command === 'react-native') {
        return { ok: true, data: { dismissed: true } };
      }
      return { ok: false, error: { code: 'UNEXPECTED_COMMAND', message: req.command } };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(calls, [
    ['wait', ['Ready', '60000']],
    ['react-native', ['dismiss-overlay']],
    ['wait', ['Ready', '60000']],
  ]);
});

test('invokeMaestroAssertVisible uses snapshot resolution for short iOS assertions', async () => {
  const calls: Array<[string, string[] | undefined]> = [];
  const response = await invokeMaestroAssertVisible({
    baseReq: {
      token: 't',
      session: 's',
      flags: { platform: 'ios' },
    },
    positionals: ['label="Ready" || text="Ready" || id="Ready"', '1000'],
    invoke: async (req): Promise<DaemonResponse> => {
      calls.push([req.command, req.positionals]);
      if (req.command === 'snapshot') {
        return {
          ok: true,
          data: snapshot([node('Ready')]),
        };
      }
      return { ok: false, error: { code: 'UNEXPECTED_COMMAND', message: req.command } };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(calls, [['snapshot', []]]);
});

test('invokeMaestroAssertVisible dismisses React Native overlays during snapshot assertions', async () => {
  const calls: Array<[string, string[] | undefined]> = [];
  let snapshots = 0;
  const response = await invokeMaestroAssertVisible({
    baseReq: {
      token: 't',
      session: 's',
      flags: { platform: 'ios' },
    },
    positionals: ['label="Ready" || text="Ready" || id="Ready"', '1000'],
    invoke: async (req): Promise<DaemonResponse> => {
      calls.push([req.command, req.positionals]);
      if (req.command === 'snapshot') {
        snapshots += 1;
        return {
          ok: true,
          data: snapshot(
            snapshots === 1
              ? [
                  node('Ready'),
                  node('Runtime Error', {
                    index: 2,
                    ref: 'e2',
                    rect: { x: 0, y: 0, width: 390, height: 80 },
                  }),
                  node('Minimize', {
                    index: 3,
                    ref: 'e3',
                    type: 'Button',
                    rect: { x: 300, y: 20, width: 80, height: 44 },
                  }),
                ]
              : [node('Ready')],
            snapshots,
          ),
        };
      }
      if (req.command === 'react-native') {
        return { ok: true, data: { dismissed: true } };
      }
      return { ok: false, error: { code: 'UNEXPECTED_COMMAND', message: req.command } };
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(calls, [
    ['snapshot', []],
    ['react-native', ['dismiss-overlay']],
    ['snapshot', []],
  ]);
});

test('invokeMaestroAssertVisible fails fast when a RedBox has no dismiss target', async () => {
  const calls: Array<[string, string[] | undefined]> = [];
  const response = await invokeMaestroAssertVisible({
    baseReq: {
      token: 't',
      session: 's',
      flags: { platform: 'ios' },
    },
    positionals: ['label="Ready" || text="Ready" || id="Ready"', '1000'],
    invoke: async (req): Promise<DaemonResponse> => {
      calls.push([req.command, req.positionals]);
      if (req.command === 'snapshot') {
        return {
          ok: true,
          data: snapshot([
            node("Uncaught (in promise): Error: Unable to download asset from url: 'x'", {
              type: 'Other',
              rect: { x: 0, y: 0, width: 390, height: 80 },
            }),
          ]),
        };
      }
      if (req.command === 'react-native') {
        return {
          ok: false,
          error: {
            code: 'COMMAND_FAILED',
            message: 'React Native overlay detected, but no safe dismiss target was found',
          },
        };
      }
      return { ok: false, error: { code: 'UNEXPECTED_COMMAND', message: req.command } };
    },
  });

  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.match(response.error.message, /React Native overlay is covering app content/);
  }
  assert.deepEqual(calls, [
    ['snapshot', []],
    ['react-native', ['dismiss-overlay']],
  ]);
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
        nodes: [node('📌', { value: '📌', enabled: true, depth: 21, rect: undefined })],
      },
    }),
  });

  assert.equal(response.ok, true);
  if (response.ok) {
    assert.ok(response.data);
    assert.equal(response.data.stableSamples, 1);
  }
});

function snapshot(nodes: SnapshotState['nodes'], createdAt = 1): SnapshotState {
  return { createdAt, nodes };
}

function node(
  label: string,
  overrides: Partial<SnapshotState['nodes'][number]> = {},
): SnapshotState['nodes'][number] {
  return {
    index: 1,
    ref: 'e1',
    type: 'android.widget.TextView',
    label,
    rect: { x: 20, y: 80, width: 120, height: 40 },
    depth: 8,
    ...overrides,
  };
}

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
