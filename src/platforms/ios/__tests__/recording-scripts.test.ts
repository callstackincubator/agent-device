import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCmd } from '../../../utils/exec.ts';
import { getRecordingOverlaySupportWarning } from '../recording-overlay.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const recordingScriptsDir = path.resolve(
  __dirname,
  '../../../../ios-runner/AgentDeviceRunner/RecordingScripts',
);

async function assertSwiftScriptTypechecks(scriptName: string): Promise<void> {
  const scriptPath = path.join(recordingScriptsDir, scriptName);
  const result = await runCmd('xcrun', ['swiftc', '-typecheck', scriptPath], {
    allowFailure: true,
  });
  assert.equal(result.exitCode, 0, `${scriptName} should typecheck`);
}

test('recording overlay Swift script typechecks', async (t) => {
  if (process.platform !== 'darwin') {
    t.skip('Swift recording scripts are only validated on macOS');
  }

  await assertSwiftScriptTypechecks('recording-overlay.swift');
});

test('recording trim Swift script typechecks', async (t) => {
  if (process.platform !== 'darwin') {
    t.skip('Swift recording scripts are only validated on macOS');
  }

  await assertSwiftScriptTypechecks('recording-trim.swift');
});

test('recording inspect Swift script typechecks', async (t) => {
  if (process.platform !== 'darwin') {
    t.skip('Swift recording scripts are only validated on macOS');
  }

  await assertSwiftScriptTypechecks('recording-inspect.swift');
});

test('recording overlays are explicitly unsupported on non-macOS hosts', () => {
  assert.equal(
    getRecordingOverlaySupportWarning('linux'),
    'touch overlay burn-in is only available on macOS hosts; returning raw video plus gesture telemetry',
  );
  assert.equal(getRecordingOverlaySupportWarning('darwin'), undefined);
});
