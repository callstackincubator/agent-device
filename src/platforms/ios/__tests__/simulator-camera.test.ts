import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test, vi } from 'vitest';
import { IOS_DEVICE, IOS_SIMULATOR } from '../../../__tests__/test-utils/device-fixtures.ts';
import { AppError } from '../../../utils/errors.ts';
import { runCmdDetached } from '../../../utils/exec.ts';
import {
  prepareIosSimulatorCameraVideo,
  stopIosSimulatorCameraVideo,
} from '../simulator-camera.ts';

vi.mock('../../../utils/exec.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/exec.ts')>();
  return {
    ...actual,
    runCmdDetached: vi.fn(() => 987_654),
  };
});

const mockRunCmdDetached = vi.mocked(runCmdDetached);

afterEach(() => {
  mockRunCmdDetached.mockClear();
});

test('prepareIosSimulatorCameraVideo starts vendored helper and returns simctl child env', async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-camera-test-'));
  const videoPath = path.join(tempDir, 'sample.mp4');
  await fsp.writeFile(videoPath, 'fixture');
  try {
    const launch = await prepareIosSimulatorCameraVideo({
      device: IOS_SIMULATOR,
      bundleId: 'com.example.camera',
      videoPath,
    });

    assert.equal(mockRunCmdDetached.mock.calls.length, 1);
    const [helperPath, helperArgs, helperOptions] = mockRunCmdDetached.mock.calls[0] ?? [];
    assert.match(helperPath ?? '', /third_party\/serve-sim-camera\/bin\/camera-helper$/);
    assert.deepEqual(helperArgs, [
      '--shm',
      launch.shmName,
      '--source',
      'video',
      '--arg',
      videoPath,
    ]);
    assert.equal(launch.helperPid, 987_654);
    assert.equal(launch.videoPath, videoPath);
    assert.match(launch.shmName, /^\/ad-camera-[a-f0-9]{12}$/);
    assert.deepEqual(helperOptions?.stdio?.[0], 'ignore');
    assert.equal(typeof helperOptions?.stdio?.[1], 'number');
    assert.equal(helperOptions?.stdio?.[2], helperOptions?.stdio?.[1]);
    assert.match(
      launch.env.SIMCTL_CHILD_DYLD_INSERT_LIBRARIES ?? '',
      /camera-injector\.dylib$/,
    );
    const shmEnvKey = Object.keys(launch.env).find((key) => key.endsWith('_SHM_NAME'));
    const mirrorEnvKey = Object.keys(launch.env).find((key) => key.endsWith('_MIRROR_MODE'));
    assert.equal(launch.env[shmEnvKey ?? ''], launch.shmName);
    assert.equal(launch.env[mirrorEnvKey ?? ''], 'auto');
  } finally {
    await stopIosSimulatorCameraVideo(IOS_SIMULATOR, 'com.example.camera');
    await fsp.rm(tempDir, { force: true, recursive: true });
  }
});

test('prepareIosSimulatorCameraVideo rejects non-simulator devices', async () => {
  await assert.rejects(
    () =>
      prepareIosSimulatorCameraVideo({
        device: IOS_DEVICE,
        bundleId: 'com.example.camera',
        videoPath: '/tmp/sample.mp4',
      }),
    (error: unknown) => {
      assert.equal(error instanceof AppError, true);
      assert.equal((error as AppError).code, 'UNSUPPORTED_OPERATION');
      return true;
    },
  );
});
