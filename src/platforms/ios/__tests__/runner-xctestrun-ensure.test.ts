import { test, vi, onTestFinished, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DeviceInfo } from '../../../utils/device.ts';
import { AppError } from '../../../utils/errors.ts';

vi.mock('../runner-macos-products.ts', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../runner-macos-products.ts')>();
  return {
    ...original,
    repairMacOsRunnerProductsIfNeeded: vi.fn(async () => {}),
  };
});

vi.mock('../runner-xctestrun-products.ts', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../runner-xctestrun-products.ts')>();
  return {
    ...original,
    resolveExistingXctestrunProductPaths: vi.fn(() => ['/tmp/runner.app']),
  };
});

vi.mock('../../../utils/exec.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../utils/exec.ts')>();
  return {
    ...original,
    runCmdStreaming: vi.fn(async () => {}),
  };
});

const { ensureXctestrun } = await import('../runner-xctestrun.ts');
const { repairMacOsRunnerProductsIfNeeded } = await import('../runner-macos-products.ts');
const { runCmdStreaming } = await import('../../../utils/exec.ts');

beforeEach(() => {
  vi.clearAllMocks();
});

const macOsDevice: DeviceInfo = {
  platform: 'macos',
  id: 'host-macos-local',
  name: 'Mac',
  kind: 'device',
  target: 'desktop',
  booted: true,
};

async function makeTmpDir(): Promise<string> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'runner-xctestrun-test-'));
  onTestFinished(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });
  return tmpDir;
}

function setEnvForTest(env: Record<string, string | undefined>) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  onTestFinished(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

test('ensureXctestrun rebuilds after cached macOS runner repair failure', async () => {
  const tmpDir = await makeTmpDir();
  const projectRoot = path.join(tmpDir, 'project');
  const derivedPath = path.join(tmpDir, 'derived');
  const projectPath = path.join(
    projectRoot,
    'ios-runner',
    'AgentDeviceRunner',
    'AgentDeviceRunner.xcodeproj',
  );
  await fs.promises.mkdir(path.dirname(projectPath), { recursive: true });
  fs.writeFileSync(projectPath, '', 'utf8');

  const existingXctestrunPath = path.join(derivedPath, 'existing.xctestrun');
  const rebuiltXctestrunPath = path.join(derivedPath, 'rebuilt.xctestrun');
  await fs.promises.mkdir(derivedPath, { recursive: true });
  // Write the project root into the file so xctestrunReferencesProjectRoot returns true
  fs.writeFileSync(existingXctestrunPath, projectRoot, 'utf8');

  setEnvForTest({
    AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH: derivedPath,
    AGENT_DEVICE_IOS_ALLOW_OVERRIDE_DERIVED_CLEAN: '1',
    AGENT_DEVICE_PROJECT_ROOT: projectRoot,
  });

  const mockedRepair = vi.mocked(repairMacOsRunnerProductsIfNeeded);
  const repairedPaths: string[] = [];
  mockedRepair.mockImplementation(async (_device, _productPaths, xctestrunPath) => {
    repairedPaths.push(xctestrunPath);
    if (xctestrunPath === existingXctestrunPath) {
      throw new AppError('COMMAND_FAILED', 'cached runner is damaged', {
        reason: 'RUNNER_PRODUCT_REPAIR_FAILED',
      });
    }
  });

  // Simulate the build creating the rebuilt xctestrun file
  vi.mocked(runCmdStreaming).mockImplementation(async () => {
    fs.writeFileSync(rebuiltXctestrunPath, projectRoot, 'utf8');
    return undefined as never;
  });

  const result = await ensureXctestrun(macOsDevice, {});

  assert.equal(result, rebuiltXctestrunPath);
  assert.deepEqual(repairedPaths, [existingXctestrunPath, rebuiltXctestrunPath]);
  // Verify build was called
  assert.equal(vi.mocked(runCmdStreaming).mock.calls.length, 1);
});

test('ensureXctestrun rethrows unexpected cached macOS runner repair errors', async () => {
  const tmpDir = await makeTmpDir();
  const projectRoot = path.join(tmpDir, 'project');
  const derivedPath = path.join(tmpDir, 'derived');
  const projectPath = path.join(
    projectRoot,
    'ios-runner',
    'AgentDeviceRunner',
    'AgentDeviceRunner.xcodeproj',
  );
  await fs.promises.mkdir(path.dirname(projectPath), { recursive: true });
  fs.writeFileSync(projectPath, '', 'utf8');

  const existingXctestrunPath = path.join(derivedPath, 'existing.xctestrun');
  await fs.promises.mkdir(derivedPath, { recursive: true });
  fs.writeFileSync(existingXctestrunPath, projectRoot, 'utf8');

  setEnvForTest({
    AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH: derivedPath,
    AGENT_DEVICE_PROJECT_ROOT: projectRoot,
  });

  vi.mocked(repairMacOsRunnerProductsIfNeeded).mockImplementation(async () => {
    throw new Error('permission denied');
  });

  await assert.rejects(ensureXctestrun(macOsDevice, {}), /permission denied/);
  // Verify build was NOT called (error was rethrown before reaching build)
  assert.equal(vi.mocked(runCmdStreaming).mock.calls.length, 0);
});
