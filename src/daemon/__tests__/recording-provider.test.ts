import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { IOS_SIMULATOR } from '../../__tests__/test-utils/index.ts';

const { runCmdBackgroundMock } = vi.hoisted(() => ({
  runCmdBackgroundMock: vi.fn(() => ({
    child: { kill: () => true },
    wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
  })),
}));

vi.mock('../../utils/exec.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/exec.ts')>();
  return {
    ...actual,
    runCmdBackground: runCmdBackgroundMock,
  };
});

import { createLocalRecordingProvider } from '../recording-provider.ts';
import { runCmdBackground } from '../../utils/exec.ts';

const mockRunCmdBackground = vi.mocked(runCmdBackground);

test('local recording provider starts iOS simulator recordVideo through simctl', () => {
  const provider = createLocalRecordingProvider();

  const result = provider.startIosSimulatorRecording({
    device: IOS_SIMULATOR,
    outPath: '/tmp/simulator.mp4',
  });

  assert.equal(result.child.kill('SIGINT'), true);
  assert.deepEqual(mockRunCmdBackground.mock.calls, [
    [
      'xcrun',
      ['simctl', 'io', IOS_SIMULATOR.id, 'recordVideo', '/tmp/simulator.mp4'],
      { allowFailure: true },
    ],
  ]);
});
