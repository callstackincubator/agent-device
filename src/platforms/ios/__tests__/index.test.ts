import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../../utils/exec.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/exec.ts')>();
  return { ...actual, runCmd: vi.fn(actual.runCmd) };
});
vi.mock('../../../utils/retry.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/retry.ts')>();
  return { ...actual, retryWithPolicy: vi.fn(actual.retryWithPolicy) };
});
vi.mock('../runner-client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runner-client.ts')>();
  return { ...actual, runIosRunnerCommand: vi.fn(actual.runIosRunnerCommand) };
});
vi.mock('../simulator.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../simulator.ts')>();
  return {
    ...actual,
    ensureBootedSimulator: vi.fn(actual.ensureBootedSimulator),
    focusIosSimulatorWindow: vi.fn(actual.focusIosSimulatorWindow),
  };
});
vi.mock('../screenshot-status-bar.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../screenshot-status-bar.ts')>();
  return {
    ...actual,
    prepareSimulatorStatusBarForScreenshot: vi.fn(actual.prepareSimulatorStatusBarForScreenshot),
  };
});

const execActual =
  await vi.importActual<typeof import('../../../utils/exec.ts')>('../../../utils/exec.ts');
const retryActual =
  await vi.importActual<typeof import('../../../utils/retry.ts')>('../../../utils/retry.ts');
const runnerActual =
  await vi.importActual<typeof import('../runner-client.ts')>('../runner-client.ts');
const simulatorActual = await vi.importActual<typeof import('../simulator.ts')>('../simulator.ts');
const screenshotStatusBarActual = await vi.importActual<
  typeof import('../screenshot-status-bar.ts')
>('../screenshot-status-bar.ts');

import {
  closeIosApp,
  installIosApp,
  listIosApps,
  openIosApp,
  parseIosDeviceAppsPayload,
  pushIosNotification,
  readIosClipboardText,
  reinstallIosApp,
  resolveIosApp,
  screenshotIos,
  setIosSetting,
  writeIosClipboardText,
} from '../index.ts';
import {
  shouldFallbackToRunnerForIosScreenshot,
  shouldRetryIosSimulatorScreenshot,
} from '../apps.ts';
import { withMockedMacOsHelper } from './macos-helper-test-utils.ts';
import { quitMacOsApp, resolveMacOsHelperPackageRootFrom } from '../macos-helper.ts';
import {
  captureSimulatorScreenshotWithFallback,
  prepareSimulatorStatusBarForScreenshot,
  resolveSimulatorRunnerScreenshotCandidatePaths,
} from '../screenshot.ts';
import { ensureBootedSimulator, focusIosSimulatorWindow } from '../simulator.ts';
import { prepareSimulatorStatusBarForScreenshot as prepareStatusBarForScreenshot } from '../screenshot-status-bar.ts';
import { runIosRunnerCommand } from '../runner-client.ts';
import type { DeviceInfo } from '../../../utils/device.ts';
import { withDiagnosticsScope } from '../../../utils/diagnostics.ts';
import { AppError } from '../../../utils/errors.ts';
import { runCmd } from '../../../utils/exec.ts';
import { retryWithPolicy } from '../../../utils/retry.ts';

const IOS_TEST_DEVICE: DeviceInfo = {
  platform: 'ios',
  id: 'ios-device-1',
  name: 'iPhone Device',
  kind: 'device',
  booted: true,
};

const IOS_TEST_SIMULATOR: DeviceInfo = {
  platform: 'ios',
  id: 'sim-1',
  name: 'iPhone 17 Pro',
  kind: 'simulator',
  booted: true,
};

const MACOS_TEST_DEVICE: DeviceInfo = {
  platform: 'macos',
  id: 'host-macos-local',
  name: 'Mac',
  kind: 'device',
  target: 'desktop',
  booted: true,
};

const mockRunCmd = vi.mocked(runCmd);
const mockRetryWithPolicy = vi.mocked(retryWithPolicy);
const mockRunIosRunnerCommand = vi.mocked(runIosRunnerCommand);
const mockEnsureBootedSimulator = vi.mocked(ensureBootedSimulator);
const mockFocusIosSimulatorWindow = vi.mocked(focusIosSimulatorWindow);
const mockPrepareStatusBarForScreenshot = vi.mocked(prepareStatusBarForScreenshot);

beforeEach(() => {
  vi.resetAllMocks();
  mockRunCmd.mockImplementation(execActual.runCmd);
  mockRetryWithPolicy.mockImplementation(retryActual.retryWithPolicy);
  mockRunIosRunnerCommand.mockImplementation(runnerActual.runIosRunnerCommand);
  mockEnsureBootedSimulator.mockImplementation(simulatorActual.ensureBootedSimulator);
  mockFocusIosSimulatorWindow.mockImplementation(simulatorActual.focusIosSimulatorWindow);
  mockPrepareStatusBarForScreenshot.mockImplementation(
    screenshotStatusBarActual.prepareSimulatorStatusBarForScreenshot,
  );
});

test('resolveMacOsHelperPackageRootFrom finds helper package from source and dist-like paths', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-helper-root-'));
  const helperRoot = path.join(repoRoot, 'macos-helper');
  await fs.mkdir(helperRoot, { recursive: true });
  await fs.writeFile(path.join(helperRoot, 'Package.swift'), '// test\n', 'utf8');

  try {
    const sourceLike = path.join(repoRoot, 'src', 'platforms', 'ios', 'macos-helper.ts');
    const distLike = path.join(repoRoot, 'dist', 'src', 'platforms', 'ios', 'macos-helper.js');

    assert.equal(resolveMacOsHelperPackageRootFrom(sourceLike), helperRoot);
    assert.equal(resolveMacOsHelperPackageRootFrom(distLike), helperRoot);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

async function withMockedXcrun(
  tempPrefix: string,
  script: string,
  run: (ctx: { tmpDir: string; argsLogPath: string; device: DeviceInfo }) => Promise<void>,
): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), tempPrefix));
  const xcrunPath = path.join(tmpDir, 'xcrun');
  const argsLogPath = path.join(tmpDir, 'args.log');
  const scriptWithPrivacyHelp = injectDefaultPrivacyHelp(script);
  await fs.writeFile(xcrunPath, scriptWithPrivacyHelp, 'utf8');
  await fs.chmod(xcrunPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

  try {
    await run({ tmpDir, argsLogPath, device: IOS_TEST_DEVICE });
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) {
      delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
    } else {
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function withMockedMacTools(
  tempPrefix: string,
  scripts: Record<string, string>,
  run: (ctx: { tmpDir: string; files: Record<string, string> }) => Promise<void>,
): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), tempPrefix));
  const files: Record<string, string> = {};
  for (const [name, content] of Object.entries(scripts)) {
    const filePath = path.join(tmpDir, name);
    await fs.writeFile(filePath, content, 'utf8');
    await fs.chmod(filePath, 0o755);
    files[name] = filePath;
  }

  const previousPath = process.env.PATH;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;

  try {
    await run({ tmpDir, files });
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function injectDefaultPrivacyHelp(script: string): string {
  if (script.includes('AGENT_DEVICE_CUSTOM_PRIVACY_HELP')) return script;
  const helpBlock = `if [ "$1" = "simctl" ] && [ "$2" = "privacy" ] && [ "$3" = "help" ]; then
  cat <<'HELP'
Usage: simctl privacy <device> <action> <service> [<bundle identifier>]

        service
             The service:
                 all - Apply the action to all services.
                 calendar - Allow access to calendar.
                 contacts-limited - Allow access to basic contact info.
                 contacts - Allow access to full contact details.
                 location - Allow access to location services when app is in use.
                 location-always - Allow access to location services at all times.
                 photos-add - Allow adding photos to the photo library.
                 photos - Allow full access to the photo library.
                 media-library - Allow access to the media library.
                 microphone - Allow access to audio input.
                 motion - Allow access to motion and fitness data.
                 reminders - Allow access to reminders.
                 siri - Allow use of the app with Siri.
                 camera - Allow access to camera.
                 notifications - Allow access to notifications.
HELP
  exit 0
fi
`;
  const shebang = '#!/bin/sh\n';
  if (!script.startsWith(shebang)) return `${shebang}${helpBlock}${script}`;
  return `${shebang}${helpBlock}${script.slice(shebang.length)}`;
}

test('openIosApp custom scheme deep links on iOS devices require app bundle context', async () => {
  const device: DeviceInfo = {
    platform: 'ios',
    id: 'ios-device-1',
    name: 'iPhone Device',
    kind: 'device',
    booted: true,
  };

  await assert.rejects(
    () => openIosApp(device, 'myapp://home'),
    (error: unknown) => {
      assert.equal(error instanceof AppError, true);
      assert.equal((error as AppError).code, 'INVALID_ARGS');
      return true;
    },
  );
});

test('shouldFallbackToRunnerForIosScreenshot detects removed devicectl subcommand output', () => {
  const error = new AppError('COMMAND_FAILED', 'Failed to capture iOS screenshot', {
    stderr: "error: Unknown option '--device'",
  });
  assert.equal(shouldFallbackToRunnerForIosScreenshot(error), true);
});

test('shouldFallbackToRunnerForIosScreenshot ignores unrelated command failures', () => {
  const error = new AppError('COMMAND_FAILED', 'Failed to capture iOS screenshot', {
    stderr: 'error: device is busy connecting',
  });
  assert.equal(shouldFallbackToRunnerForIosScreenshot(error), false);
});

test('shouldRetryIosSimulatorScreenshot detects simulator screen-surface timeout', () => {
  const error = new AppError('COMMAND_FAILED', 'Detected file type from extension: PNG', {
    stderr: 'Timeout waiting for screen surfaces',
    exitCode: 60,
  });
  assert.equal(shouldRetryIosSimulatorScreenshot(error), true);
});

test('shouldRetryIosSimulatorScreenshot detects timed out simctl screenshot command', () => {
  const error = new AppError('COMMAND_FAILED', 'xcrun timed out after 20000ms', {
    args: ['simctl', 'io', 'sim-1', 'screenshot', '/tmp/out.png'],
    timeoutMs: 20_000,
  });
  assert.equal(shouldRetryIosSimulatorScreenshot(error), true);
});

test('shouldRetryIosSimulatorScreenshot ignores unrelated screenshot failures', () => {
  const error = new AppError('COMMAND_FAILED', 'Failed to capture iOS screenshot', {
    stderr: 'No such file or directory',
    exitCode: 2,
  });
  assert.equal(shouldRetryIosSimulatorScreenshot(error), false);
});

test('captureSimulatorScreenshotWithFallback falls back to runner after retry exhaustion', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-runner-fallback-'));
  let ensureBootedCalls = 0;
  const containerPath = path.join(tmpDir, 'container');
  const runnerImage = path.join(containerPath, 'tmp', 'fallback.png');
  await fs.mkdir(path.dirname(runnerImage), { recursive: true });
  await fs.writeFile(runnerImage, 'runner-image', 'utf8');
  mockEnsureBootedSimulator.mockImplementation(async () => {
    ensureBootedCalls += 1;
  });
  mockFocusIosSimulatorWindow.mockResolvedValue(undefined);
  mockPrepareStatusBarForScreenshot.mockResolvedValue(async () => {});
  mockRetryWithPolicy.mockRejectedValue(
    new AppError('COMMAND_FAILED', 'Detected file type from extension: PNG', {
      stderr: 'Timeout waiting for screen surfaces',
      exitCode: 60,
    }),
  );
  mockRunIosRunnerCommand.mockResolvedValue({ message: 'tmp/fallback.png' });
  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('get_app_container')) {
      return { exitCode: 0, stdout: `${containerPath}\n`, stderr: '' };
    }
    throw new Error(`Unexpected xcrun args: ${args.join(' ')}`);
  });

  try {
    const outPath = path.join(tmpDir, 'out.png');
    await captureSimulatorScreenshotWithFallback(IOS_TEST_SIMULATOR, outPath, 'com.example.app');
    assert.equal(ensureBootedCalls, 1);
    assert.equal(mockRetryWithPolicy.mock.calls.length, 1);
    assert.equal(mockRunIosRunnerCommand.mock.calls.length, 1);
    assert.equal(await fs.readFile(outPath, 'utf8'), 'runner-image');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('captureSimulatorScreenshotWithFallback falls back to runner after simctl screenshot timeout', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-runner-timeout-'));
  const containerPath = path.join(tmpDir, 'container');
  const runnerImage = path.join(containerPath, 'tmp', 'fallback-timeout.png');
  await fs.mkdir(path.dirname(runnerImage), { recursive: true });
  await fs.writeFile(runnerImage, 'runner-timeout', 'utf8');
  mockEnsureBootedSimulator.mockResolvedValue(undefined);
  mockFocusIosSimulatorWindow.mockResolvedValue(undefined);
  mockPrepareStatusBarForScreenshot.mockResolvedValue(async () => {});
  mockRetryWithPolicy.mockRejectedValue(
    new AppError('COMMAND_FAILED', 'xcrun timed out after 20000ms', {
      args: ['simctl', 'io', 'sim-1', 'screenshot', '/tmp/out.png'],
      timeoutMs: 20_000,
    }),
  );
  mockRunIosRunnerCommand.mockResolvedValue({ message: 'tmp/fallback-timeout.png' });
  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('get_app_container')) {
      return { exitCode: 0, stdout: `${containerPath}\n`, stderr: '' };
    }
    throw new Error(`Unexpected xcrun args: ${args.join(' ')}`);
  });

  try {
    const outPath = path.join(tmpDir, 'out.png');
    await captureSimulatorScreenshotWithFallback(IOS_TEST_SIMULATOR, outPath, 'com.example.app');
    assert.equal(mockRunIosRunnerCommand.mock.calls.length, 1);
    assert.equal(await fs.readFile(outPath, 'utf8'), 'runner-timeout');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('captureSimulatorScreenshotWithFallback continues when status bar preparation fails', async () => {
  mockPrepareStatusBarForScreenshot.mockRejectedValue(
    new AppError('COMMAND_FAILED', 'status_bar override failed'),
  );
  mockEnsureBootedSimulator.mockResolvedValue(undefined);
  mockFocusIosSimulatorWindow.mockResolvedValue(undefined);
  mockRetryWithPolicy.mockResolvedValue(undefined);
  await captureSimulatorScreenshotWithFallback(
    IOS_TEST_SIMULATOR,
    '/tmp/out.png',
    'com.example.app',
  );
  assert.equal(mockRetryWithPolicy.mock.calls.length > 0, true);
  assert.equal(mockRunIosRunnerCommand.mock.calls.length, 0);
});

test('captureSimulatorScreenshotWithFallback ignores status bar restore failures', async () => {
  mockPrepareStatusBarForScreenshot.mockResolvedValue(async () => {
    throw new AppError('COMMAND_FAILED', 'status_bar clear failed');
  });
  mockEnsureBootedSimulator.mockResolvedValue(undefined);
  mockFocusIosSimulatorWindow.mockResolvedValue(undefined);
  mockRetryWithPolicy.mockResolvedValue(undefined);
  await captureSimulatorScreenshotWithFallback(
    IOS_TEST_SIMULATOR,
    '/tmp/out.png',
    'com.example.app',
  );
  assert.equal(mockRetryWithPolicy.mock.calls.length > 0, true);
  assert.equal(mockRunIosRunnerCommand.mock.calls.length, 0);
});

test('captureSimulatorScreenshotWithFallback emits fallback diagnostic before using runner', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-screenshot-diag-test-'));
  const logPath = path.join(tmpDir, 'diag.ndjson');
  try {
    await withDiagnosticsScope(
      {
        debug: true,
        logPath,
        session: 'ios-test',
        requestId: 'req-1',
        command: 'screenshot',
      },
      async () => {
        const containerPath = path.join(tmpDir, 'container');
        const runnerImage = path.join(containerPath, 'tmp', 'diag-fallback.png');
        await fs.mkdir(path.dirname(runnerImage), { recursive: true });
        await fs.writeFile(runnerImage, 'diag-fallback', 'utf8');
        mockEnsureBootedSimulator.mockResolvedValue(undefined);
        mockFocusIosSimulatorWindow.mockResolvedValue(undefined);
        mockPrepareStatusBarForScreenshot.mockResolvedValue(async () => {});
        mockRetryWithPolicy.mockRejectedValue(
          new AppError('COMMAND_FAILED', 'xcrun timed out after 20000ms', {
            args: ['simctl', 'io', 'sim-1', 'screenshot', '/tmp/out.png'],
            timeoutMs: 20_000,
          }),
        );
        mockRunIosRunnerCommand.mockResolvedValue({ message: 'tmp/diag-fallback.png' });
        mockRunCmd.mockImplementation(async (_cmd, args) => {
          if (args.includes('get_app_container')) {
            return { exitCode: 0, stdout: `${containerPath}\n`, stderr: '' };
          }
          throw new Error(`Unexpected xcrun args: ${args.join(' ')}`);
        });
        await captureSimulatorScreenshotWithFallback(
          IOS_TEST_SIMULATOR,
          '/tmp/out.png',
          'com.example.app',
        );
      },
    );

    const log = await waitForFileText(logPath);
    assert.match(log, /"phase":"ios_screenshot_fallback"/);
    assert.match(log, /"deviceId":"sim-1"/);
    assert.match(log, /"errorCode":"COMMAND_FAILED"/);
    assert.match(log, /"from":"simctl_screenshot"/);
    assert.match(log, /"to":"runner"/);
    assert.match(log, /"commandArgs":"simctl io sim-1 screenshot \/tmp\/out\.png"/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test(
  'focusIosSimulatorWindow times out instead of hanging indefinitely',
  { timeout: 15_000 },
  async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-focus-timeout-test-'));
    const openPath = path.join(tmpDir, 'open');
    await fs.writeFile(openPath, '#!/bin/sh\nsleep 10\n', 'utf8');
    await fs.chmod(openPath, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;

    try {
      await assert.rejects(
        () => focusIosSimulatorWindow(),
        (error: unknown) => {
          assert.equal(error instanceof AppError, true);
          assert.equal((error as AppError).code, 'COMMAND_FAILED');
          assert.match((error as AppError).message, /open timed out after 10000ms/);
          return true;
        },
      );
    } finally {
      process.env.PATH = previousPath;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  },
);

test('prepareSimulatorStatusBarForScreenshot restores prior visible overrides', async () => {
  await withMockedXcrun(
    'agent-device-ios-status-bar-restore-test-',
    `#!/bin/sh
echo "$*" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
if [ "$1" = "simctl" ] && [ "$2" = "status_bar" ] && [ "$4" = "list" ]; then
  cat <<'OUT'
Current Status Bar Overrides:
=============================
Time: 6:07
DataNetworkType: 0
WiFi Mode: 2, WiFi Bars: 0
Cell Mode: 2, Cell Bars: 0
Operator Name: No Service
Battery State: 1, Battery Level: 42, Not Charging: 0
OUT
  exit 0
fi
if [ "$1" = "simctl" ] && [ "$2" = "status_bar" ] && [ "$4" = "clear" ]; then
  exit 0
fi
if [ "$1" = "simctl" ] && [ "$2" = "status_bar" ] && [ "$4" = "override" ]; then
  exit 0
fi
echo "unexpected xcrun args: $*" >&2
exit 1
`,
    async ({ argsLogPath }) => {
      const restore = await prepareSimulatorStatusBarForScreenshot(IOS_TEST_SIMULATOR);
      await restore();

      const logLines = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
      assert.deepEqual(logLines, [
        'simctl status_bar sim-1 list',
        'simctl status_bar sim-1 clear',
        'simctl status_bar sim-1 override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 --batteryState charged --batteryLevel 100',
        'simctl status_bar sim-1 clear',
        'simctl status_bar sim-1 override --dataNetwork hide --wifiMode failed --wifiBars 0 --cellularMode failed --cellularBars 0 --operatorName No Service',
      ]);
    },
  );
});

test('prepareSimulatorStatusBarForScreenshot still normalizes when snapshotting current overrides fails', async () => {
  await withMockedXcrun(
    'agent-device-ios-status-bar-snapshot-failure-test-',
    `#!/bin/sh
echo "$*" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
if [ "$1" = "simctl" ] && [ "$2" = "status_bar" ] && [ "$4" = "list" ]; then
  echo "list failed" >&2
  exit 1
fi
if [ "$1" = "simctl" ] && [ "$2" = "status_bar" ] && [ "$4" = "clear" ]; then
  exit 0
fi
if [ "$1" = "simctl" ] && [ "$2" = "status_bar" ] && [ "$4" = "override" ]; then
  exit 0
fi
echo "unexpected xcrun args: $*" >&2
exit 1
`,
    async ({ argsLogPath }) => {
      const restore = await prepareSimulatorStatusBarForScreenshot(IOS_TEST_SIMULATOR);
      await restore();

      const logLines = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
      assert.deepEqual(logLines, [
        'simctl status_bar sim-1 list',
        'simctl status_bar sim-1 clear',
        'simctl status_bar sim-1 override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 --batteryState charged --batteryLevel 100',
        'simctl status_bar sim-1 clear',
      ]);
    },
  );
});

async function waitForFileText(filePath: string, attempts = 20): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

test('resolveSimulatorRunnerScreenshotCandidatePaths includes tmp-based and basename fallbacks', () => {
  const containerPath = '/tmp/container';
  const candidates = resolveSimulatorRunnerScreenshotCandidatePaths(
    containerPath,
    '/var/mobile/Containers/Data/Application/abc/tmp/screenshot-1.png',
  );
  assert.equal(candidates.includes(path.join(containerPath, 'tmp', 'screenshot-1.png')), true);
  assert.equal(
    candidates.includes('/var/mobile/Containers/Data/Application/abc/tmp/screenshot-1.png'),
    true,
  );
});

test('resolveSimulatorRunnerScreenshotCandidatePaths handles empty runner path', () => {
  assert.deepEqual(resolveSimulatorRunnerScreenshotCandidatePaths('/tmp/container', '   '), []);
});

test('screenshotIos retries simulator capture timeouts and eventually succeeds', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-device-ios-screenshot-retry-test-'),
  );
  const xcrunPath = path.join(tmpDir, 'xcrun');
  const openPath = path.join(tmpDir, 'open');
  const commandLogPath = path.join(tmpDir, 'commands.log');
  const screenshotCountPath = path.join(tmpDir, 'screenshot-attempts.count');
  const outPath = path.join(tmpDir, 'screen.png');

  await fs.writeFile(
    xcrunPath,
    [
      '#!/bin/sh',
      'echo "__XCRUN__ $*" >> "$AGENT_DEVICE_TEST_COMMAND_LOG"',
      'if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "-j" ]; then',
      '  echo \'{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"udid":"sim-1","state":"Booted"}]}}\'',
      '  exit 0',
      'fi',
      'if [ "$1" = "simctl" ] && [ "$2" = "io" ] && [ "$3" = "sim-1" ] && [ "$4" = "screenshot" ]; then',
      '  count=0',
      '  if [ -f "$AGENT_DEVICE_TEST_SCREENSHOT_COUNT_FILE" ]; then',
      '    count=$(cat "$AGENT_DEVICE_TEST_SCREENSHOT_COUNT_FILE")',
      '  fi',
      '  count=$((count + 1))',
      '  echo "$count" > "$AGENT_DEVICE_TEST_SCREENSHOT_COUNT_FILE"',
      '  if [ "$count" -lt 3 ]; then',
      '    echo "Detected file type from extension: PNG" >&2',
      '    echo "Timeout waiting for screen surfaces" >&2',
      '    exit 60',
      '  fi',
      '  printf "png-bytes" > "$5"',
      '  exit 0',
      'fi',
      'echo "unexpected xcrun args: $*" >&2',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(xcrunPath, 0o755);
  await fs.writeFile(
    openPath,
    '#!/bin/sh\necho "__OPEN__ $*" >> "$AGENT_DEVICE_TEST_COMMAND_LOG"\nexit 0\n',
    'utf8',
  );
  await fs.chmod(openPath, 0o755);

  const previousPath = process.env.PATH;
  const previousCommandLog = process.env.AGENT_DEVICE_TEST_COMMAND_LOG;
  const previousScreenshotCountFile = process.env.AGENT_DEVICE_TEST_SCREENSHOT_COUNT_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_COMMAND_LOG = commandLogPath;
  process.env.AGENT_DEVICE_TEST_SCREENSHOT_COUNT_FILE = screenshotCountPath;

  try {
    await screenshotIos(IOS_TEST_SIMULATOR, outPath);
    assert.equal(await fs.readFile(outPath, 'utf8'), 'png-bytes');
    assert.equal(await fs.readFile(screenshotCountPath, 'utf8'), '3\n');

    const logLines = (await fs.readFile(commandLogPath, 'utf8')).trim().split('\n').filter(Boolean);
    assert.equal(
      logLines.filter((line) => line === '__OPEN__ -a Simulator').length,
      3,
      'should focus Simulator before first screenshot and between retries',
    );
    assert.equal(
      logLines.filter((line) => line === '__XCRUN__ simctl io sim-1 screenshot ' + outPath).length,
      3,
      'should retry screenshot command until success',
    );
  } finally {
    process.env.PATH = previousPath;
    if (previousCommandLog === undefined) delete process.env.AGENT_DEVICE_TEST_COMMAND_LOG;
    else process.env.AGENT_DEVICE_TEST_COMMAND_LOG = previousCommandLog;
    if (previousScreenshotCountFile === undefined)
      delete process.env.AGENT_DEVICE_TEST_SCREENSHOT_COUNT_FILE;
    else process.env.AGENT_DEVICE_TEST_SCREENSHOT_COUNT_FILE = previousScreenshotCountFile;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('openIosApp web URL on iOS device without app falls back to Safari', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-safari-test-'));
  const xcrunPath = path.join(tmpDir, 'xcrun');
  const argsLogPath = path.join(tmpDir, 'args.log');
  await fs.writeFile(
    xcrunPath,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    'utf8',
  );
  await fs.chmod(xcrunPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

  const device: DeviceInfo = {
    platform: 'ios',
    id: 'ios-device-1',
    name: 'iPhone Device',
    kind: 'device',
    booted: true,
  };

  try {
    await openIosApp(device, 'https://example.com/path');
    const args = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
    assert.deepEqual(args, [
      'devicectl',
      'device',
      'process',
      'launch',
      '--device',
      'ios-device-1',
      'com.apple.mobilesafari',
      '--payload-url',
      'https://example.com/path',
    ]);
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) {
      delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
    } else {
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('openIosApp custom scheme on iOS device uses active app context', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-openurl-test-'));
  const xcrunPath = path.join(tmpDir, 'xcrun');
  const argsLogPath = path.join(tmpDir, 'args.log');
  await fs.writeFile(
    xcrunPath,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    'utf8',
  );
  await fs.chmod(xcrunPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

  const device: DeviceInfo = {
    platform: 'ios',
    id: 'ios-device-1',
    name: 'iPhone Device',
    kind: 'device',
    booted: true,
  };

  try {
    await openIosApp(device, 'myapp://item/42', { appBundleId: 'com.example.app' });
    const args = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
    assert.deepEqual(args, [
      'devicectl',
      'device',
      'process',
      'launch',
      '--device',
      'ios-device-1',
      'com.example.app',
      '--payload-url',
      'myapp://item/42',
    ]);
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) {
      delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
    } else {
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('writeIosClipboardText uses simctl pbcopy with stdin', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-clipboard-write-test-'));
  const xcrunPath = path.join(tmpDir, 'xcrun');
  const argsLogPath = path.join(tmpDir, 'args.log');
  const stdinLogPath = path.join(tmpDir, 'stdin.log');
  await fs.writeFile(
    xcrunPath,
    [
      '#!/bin/sh',
      'printf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "-j" ]; then',
      '  echo \'{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"udid":"sim-1","state":"Booted"}]}}\'',
      '  exit 0',
      'fi',
      'if [ "$1" = "simctl" ] && [ "$2" = "pbcopy" ]; then',
      '  cat > "$AGENT_DEVICE_TEST_STDIN_FILE"',
      '  exit 0',
      'fi',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(xcrunPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  const previousStdinFile = process.env.AGENT_DEVICE_TEST_STDIN_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;
  process.env.AGENT_DEVICE_TEST_STDIN_FILE = stdinLogPath;

  try {
    await writeIosClipboardText(IOS_TEST_SIMULATOR, 'hello otp');
    const args = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
    assert.deepEqual(args, ['simctl', 'pbcopy', 'sim-1']);
    assert.equal(await fs.readFile(stdinLogPath, 'utf8'), 'hello otp');
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) {
      delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
    } else {
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
    }
    if (previousStdinFile === undefined) {
      delete process.env.AGENT_DEVICE_TEST_STDIN_FILE;
    } else {
      process.env.AGENT_DEVICE_TEST_STDIN_FILE = previousStdinFile;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('readIosClipboardText uses simctl pbpaste', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-clipboard-read-test-'));
  const xcrunPath = path.join(tmpDir, 'xcrun');
  const argsLogPath = path.join(tmpDir, 'args.log');
  await fs.writeFile(
    xcrunPath,
    [
      '#!/bin/sh',
      'printf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "-j" ]; then',
      '  echo \'{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"udid":"sim-1","state":"Booted"}]}}\'',
      '  exit 0',
      'fi',
      'if [ "$1" = "simctl" ] && [ "$2" = "pbpaste" ]; then',
      '  echo "copied-value"',
      '  exit 0',
      'fi',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(xcrunPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

  try {
    const text = await readIosClipboardText(IOS_TEST_SIMULATOR);
    assert.equal(text, 'copied-value');
    const logged = await fs.readFile(argsLogPath, 'utf8');
    assert.match(logged, /simctl\npbpaste\nsim-1/);
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) {
      delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
    } else {
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('readIosClipboardText rejects physical devices', async () => {
  await assert.rejects(
    () => readIosClipboardText(IOS_TEST_DEVICE),
    (error: unknown) => {
      assert.equal(error instanceof AppError, true);
      assert.equal((error as AppError).code, 'UNSUPPORTED_OPERATION');
      return true;
    },
  );
});

test('writeIosClipboardText uses pbcopy on macOS', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-device-macos-clipboard-write-test-'),
  );
  const pbcopyPath = path.join(tmpDir, 'pbcopy');
  const stdinLogPath = path.join(tmpDir, 'stdin.log');
  await fs.writeFile(pbcopyPath, '#!/bin/sh\ncat > "$AGENT_DEVICE_TEST_STDIN_FILE"\n', 'utf8');
  await fs.chmod(pbcopyPath, 0o755);

  const previousPath = process.env.PATH;
  const previousStdinFile = process.env.AGENT_DEVICE_TEST_STDIN_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_STDIN_FILE = stdinLogPath;

  try {
    await writeIosClipboardText(MACOS_TEST_DEVICE, 'desktop clipboard');
    assert.equal(await fs.readFile(stdinLogPath, 'utf8'), 'desktop clipboard');
  } finally {
    process.env.PATH = previousPath;
    if (previousStdinFile === undefined) delete process.env.AGENT_DEVICE_TEST_STDIN_FILE;
    else process.env.AGENT_DEVICE_TEST_STDIN_FILE = previousStdinFile;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('readIosClipboardText uses pbpaste on macOS', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-device-macos-clipboard-read-test-'),
  );
  const pbpastePath = path.join(tmpDir, 'pbpaste');
  await fs.writeFile(pbpastePath, '#!/bin/sh\necho "desktop-value"\n', 'utf8');
  await fs.chmod(pbpastePath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;

  try {
    const text = await readIosClipboardText(MACOS_TEST_DEVICE);
    assert.equal(text, 'desktop-value');
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('openIosApp on macOS resolves aliases before invoking open', async () => {
  await withMockedMacTools(
    'agent-device-macos-open-alias-test-',
    {
      open: '#!/bin/sh\nprintf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"\n',
    },
    async ({ tmpDir }) => {
      const argsLogPath = path.join(tmpDir, 'args.log');
      const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

      try {
        await openIosApp(MACOS_TEST_DEVICE, 'settings');
        const logged = await fs.readFile(argsLogPath, 'utf8');
        assert.equal(logged, '-b\ncom.apple.systempreferences\n');
      } finally {
        if (previousArgsFile === undefined) delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
        else process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
      }
    },
  );
});

test('closeIosApp on macOS uses helper quit for bundle identifiers', async () => {
  await withMockedMacOsHelper(
    [
      '#!/bin/sh',
      'printf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"',
      "cat <<'JSON'",
      '{"ok":true,"data":{"bundleId":"com.example.foobar","running":true,"terminated":true,"forceTerminated":false}}',
      'JSON',
      '',
    ].join('\n'),
    async ({ tmpDir }) => {
      const argsLogPath = path.join(tmpDir, 'args.log');
      const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

      try {
        await closeIosApp(MACOS_TEST_DEVICE, 'com.example.foobar');
        const logged = await fs.readFile(argsLogPath, 'utf8');
        assert.equal(logged, 'app\nquit\n--bundle-id\ncom.example.foobar\n');
      } finally {
        if (previousArgsFile === undefined) delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
        else process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
      }
    },
    { tempPrefix: 'agent-device-macos-close-helper-test-' },
  );
});

test('quitMacOsApp rejects invalid bundle identifiers before invoking helper', async () => {
  await assert.rejects(() => quitMacOsApp('not a bundle id'), /reverse-DNS form/i);
});

test('reinstallIosApp on iOS physical device uses devicectl uninstall + install', async () => {
  await withMockedXcrun(
    'agent-device-ios-reinstall-device-test-',
    `#!/bin/sh
printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
if [ "$1" = "devicectl" ] && [ "$2" = "device" ] && [ "$3" = "info" ] && [ "$4" = "apps" ]; then
  out=""
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "--json-output" ]; then
      out="$2"
      shift 2
      continue
    fi
    shift
  done
  cat > "$out" <<'JSON'
{"result":{"apps":[{"bundleIdentifier":"com.example.demo","name":"Demo"}]}}
JSON
fi
exit 0
`,
    async ({ tmpDir, argsLogPath, device }) => {
      const appPath = path.join(tmpDir, 'Sample.app');
      await fs.mkdir(appPath, { recursive: true });
      const result = await reinstallIosApp(device, 'Demo', appPath);
      assert.equal(result.bundleId, 'com.example.demo');

      const args = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);

      const uninstallIdx = args.indexOf('uninstall');
      const installIdx = args.indexOf('install');
      assert.notEqual(uninstallIdx, -1);
      assert.notEqual(installIdx, -1);
      assert.equal(uninstallIdx < installIdx, true, 'reinstall should uninstall before install');
      assert.deepEqual(args.slice(uninstallIdx - 2, uninstallIdx + 5), [
        'devicectl',
        'device',
        'uninstall',
        'app',
        '--device',
        'ios-device-1',
        'com.example.demo',
      ]);
      assert.deepEqual(args.slice(installIdx - 2, installIdx + 5), [
        'devicectl',
        'device',
        'install',
        'app',
        '--device',
        'ios-device-1',
        appPath,
      ]);
    },
  );
});

test('reinstallIosApp on iOS physical device proceeds when uninstall reports app not installed', async () => {
  await withMockedXcrun(
    'agent-device-ios-reinstall-device-missing-app-test-',
    `#!/bin/sh
printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
if [ "$1" = "devicectl" ] && [ "$2" = "device" ] && [ "$3" = "info" ] && [ "$4" = "apps" ]; then
  out=""
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "--json-output" ]; then
      out="$2"
      shift 2
      continue
    fi
    shift
  done
  cat > "$out" <<'JSON'
{"result":{"apps":[{"bundleIdentifier":"com.example.demo","name":"Demo"}]}}
JSON
  exit 0
fi
if [ "$1" = "devicectl" ] && [ "$2" = "device" ] && [ "$3" = "uninstall" ] && [ "$4" = "app" ]; then
  echo "app not installed" >&2
  exit 1
fi
if [ "$1" = "devicectl" ] && [ "$2" = "device" ] && [ "$3" = "install" ] && [ "$4" = "app" ]; then
  exit 0
fi
echo "unexpected xcrun args: $@" >&2
exit 1
`,
    async ({ tmpDir, argsLogPath, device }) => {
      const appPath = path.join(tmpDir, 'Sample.app');
      await fs.mkdir(appPath, { recursive: true });
      const result = await reinstallIosApp(device, 'Demo', appPath);
      assert.equal(result.bundleId, 'com.example.demo');

      const args = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
      assert.equal(args.includes('uninstall'), true);
      assert.equal(args.includes('install'), true);
    },
  );
});

test('installIosApp on iOS physical device accepts .ipa and installs extracted .app payload', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-install-ipa-test-'));
  const xcrunPath = path.join(tmpDir, 'xcrun');
  const dittoPath = path.join(tmpDir, 'ditto');
  const argsLogPath = path.join(tmpDir, 'args.log');
  const ipaPath = path.join(tmpDir, 'Sample.ipa');
  await fs.writeFile(ipaPath, 'placeholder', 'utf8');

  await fs.writeFile(
    xcrunPath,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    'utf8',
  );
  await fs.chmod(xcrunPath, 0o755);
  await fs.writeFile(dittoPath, '#!/bin/sh\nmkdir -p "$4/Payload/Sample.app"\nexit 0\n', 'utf8');
  await fs.chmod(dittoPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

  try {
    await installIosApp(IOS_TEST_DEVICE, ipaPath);
    const args = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
    const installIdx = args.indexOf('install');
    assert.notEqual(installIdx, -1);
    assert.deepEqual(args.slice(installIdx - 2, installIdx + 4), [
      'devicectl',
      'device',
      'install',
      'app',
      '--device',
      'ios-device-1',
    ]);
    const installedPath = args[installIdx + 4];
    assert.equal(typeof installedPath, 'string');
    assert.equal(installedPath?.endsWith('/Payload/Sample.app'), true);
    assert.notEqual(installedPath, ipaPath);
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) {
      delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
    } else {
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('installIosApp returns bundleId and launchTarget for nested archive sources', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-install-archive-test-'));
  const xcrunPath = path.join(tmpDir, 'xcrun');
  const dittoPath = path.join(tmpDir, 'ditto');
  const plutilPath = path.join(tmpDir, 'plutil');
  const argsLogPath = path.join(tmpDir, 'args.log');
  const archivePath = path.join(tmpDir, 'Sample.zip');
  await fs.writeFile(archivePath, 'placeholder', 'utf8');

  await fs.writeFile(
    xcrunPath,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    'utf8',
  );
  await fs.chmod(xcrunPath, 0o755);
  await fs.writeFile(
    dittoPath,
    [
      '#!/bin/sh',
      'src="$3"',
      'out="$4"',
      'case "$src" in',
      '  *.zip)',
      '    mkdir -p "$out/Build"',
      '    printf "ipa" > "$out/Build/Sample.ipa"',
      '    exit 0',
      '    ;;',
      '  *.ipa)',
      '    mkdir -p "$out/Payload/Sample.app"',
      '    exit 0',
      '    ;;',
      'esac',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(dittoPath, 0o755);
  await fs.writeFile(
    plutilPath,
    [
      '#!/bin/sh',
      'key="$2"',
      'last_arg=""',
      'for arg in "$@"; do',
      '  last_arg="$arg"',
      'done',
      'case "$key" in',
      '  CFBundleIdentifier) echo "com.example.archive"; exit 0 ;;',
      '  CFBundleDisplayName) echo "Archive App"; exit 0 ;;',
      '  CFBundleName) echo "Archive App"; exit 0 ;;',
      'esac',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(plutilPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

  try {
    const result = await installIosApp(IOS_TEST_DEVICE, archivePath);
    const args = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
    assert.equal(result.archivePath, archivePath);
    assert.equal(result.bundleId, 'com.example.archive');
    assert.equal(result.appName, 'Archive App');
    assert.equal(result.launchTarget, 'com.example.archive');
    assert.equal(result.installablePath.endsWith('/Payload/Sample.app'), true);
    const installIdx = args.indexOf('install');
    assert.notEqual(installIdx, -1);
    assert.equal(args[installIdx + 4]?.endsWith('/Payload/Sample.app'), true);
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) {
      delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
    } else {
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('installIosApp on iOS physical device resolves multi-app .ipa using bundle identifier hint', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-device-ios-install-ipa-multi-test-'),
  );
  const xcrunPath = path.join(tmpDir, 'xcrun');
  const dittoPath = path.join(tmpDir, 'ditto');
  const plutilPath = path.join(tmpDir, 'plutil');
  const argsLogPath = path.join(tmpDir, 'args.log');
  const ipaPath = path.join(tmpDir, 'Sample.ipa');
  await fs.writeFile(ipaPath, 'placeholder', 'utf8');

  await fs.writeFile(
    xcrunPath,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    'utf8',
  );
  await fs.chmod(xcrunPath, 0o755);
  await fs.writeFile(
    dittoPath,
    '#!/bin/sh\nmkdir -p "$4/Payload/Sample.app"\nmkdir -p "$4/Payload/Companion.app"\nexit 0\n',
    'utf8',
  );
  await fs.chmod(dittoPath, 0o755);
  await fs.writeFile(
    plutilPath,
    [
      '#!/bin/sh',
      'last_arg=""',
      'for arg in "$@"; do',
      '  last_arg="$arg"',
      'done',
      'case "$last_arg" in',
      '  *"/Sample.app/"*) echo "com.example.sample"; exit 0 ;;',
      '  *"/Companion.app/"*) echo "com.example.companion"; exit 0 ;;',
      'esac',
      'echo "missing bundle id" >&2',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(plutilPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

  try {
    await installIosApp(IOS_TEST_DEVICE, ipaPath, { appIdentifierHint: 'com.example.sample' });
    const args = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
    const installIdx = args.indexOf('install');
    assert.notEqual(installIdx, -1);
    const installedPath = args[installIdx + 4];
    assert.equal(typeof installedPath, 'string');
    assert.equal(installedPath?.endsWith('/Payload/Sample.app'), true);
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) {
      delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
    } else {
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('installIosApp rejects multi-app .ipa when no hint is provided', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-device-ios-install-ipa-multi-missing-hint-test-'),
  );
  const xcrunPath = path.join(tmpDir, 'xcrun');
  const dittoPath = path.join(tmpDir, 'ditto');
  const plutilPath = path.join(tmpDir, 'plutil');
  const ipaPath = path.join(tmpDir, 'Sample.ipa');
  await fs.writeFile(ipaPath, 'placeholder', 'utf8');

  await fs.writeFile(xcrunPath, '#!/bin/sh\nexit 0\n', 'utf8');
  await fs.chmod(xcrunPath, 0o755);
  await fs.writeFile(
    dittoPath,
    '#!/bin/sh\nmkdir -p "$4/Payload/Sample.app"\nmkdir -p "$4/Payload/Companion.app"\nexit 0\n',
    'utf8',
  );
  await fs.chmod(dittoPath, 0o755);
  await fs.writeFile(
    plutilPath,
    [
      '#!/bin/sh',
      'last_arg=""',
      'for arg in "$@"; do',
      '  last_arg="$arg"',
      'done',
      'case "$last_arg" in',
      '  *"/Sample.app/"*) echo "com.example.sample"; exit 0 ;;',
      '  *"/Companion.app/"*) echo "com.example.companion"; exit 0 ;;',
      'esac',
      'echo "missing bundle id" >&2',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(plutilPath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  try {
    await assert.rejects(
      () => installIosApp(IOS_TEST_DEVICE, ipaPath),
      (error: unknown) => {
        assert.equal(error instanceof AppError, true);
        assert.equal((error as AppError).code, 'INVALID_ARGS');
        assert.match((error as AppError).message, /found 2 \.app bundles/i);
        assert.match((error as AppError).message, /pass an app identifier|bundle name/i);
        return true;
      },
    );
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('installIosApp rejects invalid .ipa payloads without embedded .app', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-device-ios-install-ipa-invalid-test-'),
  );
  const xcrunPath = path.join(tmpDir, 'xcrun');
  const dittoPath = path.join(tmpDir, 'ditto');
  const ipaPath = path.join(tmpDir, 'Broken.ipa');
  await fs.writeFile(ipaPath, 'placeholder', 'utf8');

  await fs.writeFile(xcrunPath, '#!/bin/sh\nexit 0\n', 'utf8');
  await fs.chmod(xcrunPath, 0o755);
  await fs.writeFile(dittoPath, '#!/bin/sh\nmkdir -p "$4/NoPayload"\nexit 0\n', 'utf8');
  await fs.chmod(dittoPath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  try {
    await assert.rejects(
      () => installIosApp(IOS_TEST_DEVICE, ipaPath),
      (error: unknown) => {
        assert.equal(error instanceof AppError, true);
        assert.equal((error as AppError).code, 'INVALID_ARGS');
        assert.match((error as AppError).message, /invalid ipa/i);
        return true;
      },
    );
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('openIosApp with app and URL on iOS device launches app bundle with payload URL', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-open-app-url-test-'));
  const xcrunPath = path.join(tmpDir, 'xcrun');
  const argsLogPath = path.join(tmpDir, 'args.log');
  await fs.writeFile(
    xcrunPath,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    'utf8',
  );
  await fs.chmod(xcrunPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

  const device: DeviceInfo = {
    platform: 'ios',
    id: 'ios-device-1',
    name: 'iPhone Device',
    kind: 'device',
    booted: true,
  };

  try {
    await openIosApp(device, 'MyApp', { appBundleId: 'com.example.app', url: 'myapp://screen/to' });
    const args = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
    assert.deepEqual(args, [
      'devicectl',
      'device',
      'process',
      'launch',
      '--device',
      'ios-device-1',
      'com.example.app',
      '--payload-url',
      'myapp://screen/to',
    ]);
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) {
      delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
    } else {
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('pushIosNotification uses simctl push with temporary payload file', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-push-test-'));
  const xcrunPath = path.join(tmpDir, 'xcrun');
  const argsLogPath = path.join(tmpDir, 'args.log');
  const payloadCapturePath = path.join(tmpDir, 'payload.json');
  await fs.writeFile(
    xcrunPath,
    [
      '#!/bin/sh',
      'printf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "-j" ]; then',
      '  echo \'{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"udid":"sim-1","state":"Booted"}]}}\'',
      '  exit 0',
      'fi',
      'if [ "$1" = "simctl" ] && [ "$2" = "push" ]; then',
      '  cat "$5" > "$AGENT_DEVICE_TEST_PAYLOAD_FILE"',
      '  exit 0',
      'fi',
      'exit 0',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(xcrunPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  const previousPayloadFile = process.env.AGENT_DEVICE_TEST_PAYLOAD_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;
  process.env.AGENT_DEVICE_TEST_PAYLOAD_FILE = payloadCapturePath;

  const device: DeviceInfo = {
    platform: 'ios',
    id: 'sim-1',
    name: 'iPhone',
    kind: 'simulator',
    booted: true,
  };

  try {
    await pushIosNotification(device, 'com.example.app', { aps: { alert: 'hello', badge: 4 } });
    const args = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
    assert.equal(args[0], 'simctl');
    assert.equal(args[1], 'push');
    assert.equal(args[2], 'sim-1');
    assert.equal(args[3], 'com.example.app');
    assert.match(args[4] ?? '', /payload\.apns$/);
    const payload = JSON.parse(await fs.readFile(payloadCapturePath, 'utf8')) as {
      aps: { alert: string; badge: number };
    };
    assert.deepEqual(payload, { aps: { alert: 'hello', badge: 4 } });
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
    else process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
    if (previousPayloadFile === undefined) delete process.env.AGENT_DEVICE_TEST_PAYLOAD_FILE;
    else process.env.AGENT_DEVICE_TEST_PAYLOAD_FILE = previousPayloadFile;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('parseIosDeviceAppsPayload maps devicectl app entries', () => {
  const apps = parseIosDeviceAppsPayload({
    result: {
      apps: [
        {
          bundleIdentifier: 'com.apple.Maps',
          name: 'Maps',
        },
        {
          bundleIdentifier: 'com.example.NoName',
        },
      ],
    },
  });

  assert.equal(apps.length, 2);
  assert.deepEqual(apps[0], {
    bundleId: 'com.apple.Maps',
    name: 'Maps',
  });
  assert.equal(apps[1].bundleId, 'com.example.NoName');
  assert.equal(apps[1].name, 'com.example.NoName');
});

test('parseIosDeviceAppsPayload ignores malformed entries', () => {
  const apps = parseIosDeviceAppsPayload({
    result: {
      apps: [null, {}, { name: 'Missing bundle id' }, { bundleIdentifier: '' }],
    },
  });
  assert.deepEqual(apps, []);
});

test('resolveIosApp resolves app display name on iOS physical devices', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-app-resolve-'));
  const xcrunPath = path.join(tmpDir, 'xcrun');
  await fs.writeFile(
    xcrunPath,
    [
      '#!/bin/sh',
      'if [ "$1" = "devicectl" ] && [ "$2" = "device" ] && [ "$3" = "info" ] && [ "$4" = "apps" ]; then',
      '  out=""',
      '  while [ "$#" -gt 0 ]; do',
      '    if [ "$1" = "--json-output" ]; then',
      '      out="$2"',
      '      shift 2',
      '      continue',
      '    fi',
      '    shift',
      '  done',
      '  cat > "$out" <<\'JSON\'',
      '{"result":{"apps":[{"bundleIdentifier":"com.apple.Maps","name":"Maps"},{"bundleIdentifier":"com.example.demo","name":"Demo"}]}}',
      'JSON',
      '  exit 0',
      'fi',
      'echo "unexpected xcrun args: $@" >&2',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(xcrunPath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;

  const device: DeviceInfo = {
    platform: 'ios',
    id: 'ios-device-1',
    name: 'iPhone Device',
    kind: 'device',
    booted: true,
  };

  try {
    const bundleId = await resolveIosApp(device, 'Maps');
    assert.equal(bundleId, 'com.apple.Maps');
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('listIosApps applies user-installed filter on simulator', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-list-sim-'));
  const xcrunPath = path.join(tmpDir, 'xcrun');
  await fs.writeFile(
    xcrunPath,
    [
      '#!/bin/sh',
      'if [ "$1" = "simctl" ] && [ "$2" = "listapps" ]; then',
      "  cat <<'JSON'",
      '{"com.apple.Maps":{"CFBundleDisplayName":"Maps"},"com.example.demo":{"CFBundleDisplayName":"Demo"}}',
      'JSON',
      '  exit 0',
      'fi',
      'echo "unexpected xcrun args: $@" >&2',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(xcrunPath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;

  const device: DeviceInfo = {
    platform: 'ios',
    id: 'sim-1',
    name: 'iPhone Sim',
    kind: 'simulator',
    booted: true,
  };

  try {
    const apps = await listIosApps(device, 'user-installed');
    assert.deepEqual(apps, [{ bundleId: 'com.example.demo', name: 'Demo' }]);
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('listIosApps reads standard macOS app bundles from Contents/Info.plist', async () => {
  await withMockedMacTools(
    'agent-device-macos-app-list-test-',
    {
      find: `#!/bin/sh
printf '%s\n' "$AGENT_DEVICE_TEST_MAC_APP_ONE" "$AGENT_DEVICE_TEST_MAC_APP_TWO"
`,
      plutil: `#!/bin/sh
key="$2"
last=""
for arg in "$@"; do
  last="$arg"
done
case "$key:$last" in
  CFBundleIdentifier:*Demo.app/Contents/Info.plist)
    echo "com.example.demo"
    exit 0
    ;;
  CFBundleDisplayName:*Demo.app/Contents/Info.plist)
    echo "Demo"
    exit 0
    ;;
  CFBundleName:*Demo.app/Contents/Info.plist)
    echo "Demo"
    exit 0
    ;;
  CFBundleIdentifier:*Safari.app/Contents/Info.plist)
    echo "com.apple.Safari"
    exit 0
    ;;
  CFBundleDisplayName:*Safari.app/Contents/Info.plist)
    echo "Safari"
    exit 0
    ;;
  CFBundleName:*Safari.app/Contents/Info.plist)
    echo "Safari"
    exit 0
    ;;
  *)
    exit 1
    ;;
esac
`,
    },
    async ({ tmpDir }) => {
      const applicationsPath = path.join(tmpDir, 'Applications');
      const demoAppPath = path.join(applicationsPath, 'Demo.app');
      const safariAppPath = path.join(applicationsPath, 'Safari.app');
      await fs.mkdir(path.join(demoAppPath, 'Contents'), { recursive: true });
      await fs.mkdir(path.join(safariAppPath, 'Contents'), { recursive: true });
      await fs.writeFile(path.join(demoAppPath, 'Contents', 'Info.plist'), '', 'utf8');
      await fs.writeFile(path.join(safariAppPath, 'Contents', 'Info.plist'), '', 'utf8');

      const previousAppOne = process.env.AGENT_DEVICE_TEST_MAC_APP_ONE;
      const previousAppTwo = process.env.AGENT_DEVICE_TEST_MAC_APP_TWO;
      const previousHome = process.env.HOME;
      process.env.AGENT_DEVICE_TEST_MAC_APP_ONE = demoAppPath;
      process.env.AGENT_DEVICE_TEST_MAC_APP_TWO = safariAppPath;
      process.env.HOME = tmpDir;

      try {
        const apps = await listIosApps(MACOS_TEST_DEVICE, 'all');
        assert.deepEqual(apps, [
          { bundleId: 'com.example.demo', name: 'Demo' },
          { bundleId: 'com.apple.Safari', name: 'Safari' },
        ]);
      } finally {
        if (previousAppOne === undefined) delete process.env.AGENT_DEVICE_TEST_MAC_APP_ONE;
        else process.env.AGENT_DEVICE_TEST_MAC_APP_ONE = previousAppOne;
        if (previousAppTwo === undefined) delete process.env.AGENT_DEVICE_TEST_MAC_APP_TWO;
        else process.env.AGENT_DEVICE_TEST_MAC_APP_TWO = previousAppTwo;
        if (previousHome === undefined) delete process.env.HOME;
        else process.env.HOME = previousHome;
      }
    },
  );
});

test('setIosSetting faceid match uses simctl biometric match', async () => {
  await withMockedXcrun(
    'agent-device-ios-faceid-match-test-',
    `#!/bin/sh
printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "-j" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"udid":"sim-1","state":"Booted"}]}}
JSON
  exit 0
fi
if [ "$1" = "simctl" ] && [ "$2" = "biometric" ] && [ "$3" = "sim-1" ] && [ "$4" = "match" ] && [ "$5" = "face" ]; then
  exit 0
fi
echo "unexpected xcrun args: $@" >&2
exit 1
`,
    async ({ argsLogPath }) => {
      const device: DeviceInfo = {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone Sim',
        kind: 'simulator',
        booted: true,
      };
      await setIosSetting(device, 'faceid', 'match');
      const lines = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
      const logged = lines.join(' ');
      assert.match(logged, /simctl biometric sim-1 match face/);
    },
  );
});

test('setIosSetting faceid retries alternate biometric argument order', async () => {
  await withMockedXcrun(
    'agent-device-ios-faceid-fallback-test-',
    `#!/bin/sh
printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "-j" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"udid":"sim-1","state":"Booted"}]}}
JSON
  exit 0
fi
if [ "$1" = "simctl" ] && [ "$2" = "biometric" ] && [ "$3" = "sim-1" ] && [ "$4" = "match" ] && [ "$5" = "face" ]; then
  exit 2
fi
if [ "$1" = "simctl" ] && [ "$2" = "biometric" ] && [ "$3" = "match" ] && [ "$4" = "sim-1" ] && [ "$5" = "face" ]; then
  exit 0
fi
echo "unexpected xcrun args: $@" >&2
exit 1
`,
    async ({ argsLogPath }) => {
      const device: DeviceInfo = {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone Sim',
        kind: 'simulator',
        booted: true,
      };
      await setIosSetting(device, 'faceid', 'match');
      const lines = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
      const logged = lines.join(' ');
      assert.match(logged, /simctl biometric sim-1 match face/);
      assert.match(logged, /simctl biometric match sim-1 face/);
    },
  );
});

test('setIosSetting touchid match uses simctl biometric match finger', async () => {
  await withMockedXcrun(
    'agent-device-ios-touchid-match-test-',
    `#!/bin/sh
printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "-j" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"udid":"sim-1","state":"Booted"}]}}
JSON
  exit 0
fi
if [ "$1" = "simctl" ] && [ "$2" = "biometric" ] && [ "$3" = "sim-1" ] && [ "$4" = "match" ] && [ "$5" = "finger" ]; then
  exit 0
fi
echo "unexpected xcrun args: $@" >&2
exit 1
`,
    async ({ argsLogPath }) => {
      const device: DeviceInfo = {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone Sim',
        kind: 'simulator',
        booted: true,
      };
      await setIosSetting(device, 'touchid', 'match');
      const lines = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
      const logged = lines.join(' ');
      assert.match(logged, /simctl biometric sim-1 match finger/);
    },
  );
});

test('setIosSetting touchid retries touch modality when finger fails', async () => {
  await withMockedXcrun(
    'agent-device-ios-touchid-fallback-test-',
    `#!/bin/sh
printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "-j" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"udid":"sim-1","state":"Booted"}]}}
JSON
  exit 0
fi
if [ "$1" = "simctl" ] && [ "$2" = "biometric" ] && [ "$3" = "sim-1" ] && [ "$4" = "match" ] && [ "$5" = "finger" ]; then
  exit 2
fi
if [ "$1" = "simctl" ] && [ "$2" = "biometric" ] && [ "$3" = "match" ] && [ "$4" = "sim-1" ] && [ "$5" = "finger" ]; then
  exit 2
fi
if [ "$1" = "simctl" ] && [ "$2" = "biometric" ] && [ "$3" = "sim-1" ] && [ "$4" = "match" ] && [ "$5" = "touch" ]; then
  exit 0
fi
echo "unexpected xcrun args: $@" >&2
exit 1
`,
    async ({ argsLogPath }) => {
      const device: DeviceInfo = {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone Sim',
        kind: 'simulator',
        booted: true,
      };
      await setIosSetting(device, 'touchid', 'match');
      const lines = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
      const logged = lines.join(' ');
      assert.match(logged, /simctl biometric sim-1 match finger/);
      assert.match(logged, /simctl biometric match sim-1 finger/);
      assert.match(logged, /simctl biometric sim-1 match touch/);
    },
  );
});

test('setIosSetting touchid reports unsupported when simctl biometric is unavailable', async () => {
  await withMockedXcrun(
    'agent-device-ios-touchid-unsupported-test-',
    `#!/bin/sh
if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "-j" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"udid":"sim-1","state":"Booted"}]}}
JSON
  exit 0
fi
echo "unknown subcommand biometric" >&2
exit 1
`,
    async () => {
      const device: DeviceInfo = {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone Sim',
        kind: 'simulator',
        booted: true,
      };
      await assert.rejects(
        () => setIosSetting(device, 'touchid', 'match'),
        (error: unknown) => {
          assert.equal(error instanceof AppError, true);
          assert.equal((error as AppError).code, 'UNSUPPORTED_OPERATION');
          assert.match((error as AppError).message, /Touch ID simulation is not supported/);
          return true;
        },
      );
    },
  );
});

test('setIosSetting touchid keeps COMMAND_FAILED for operational failures', async () => {
  await withMockedXcrun(
    'agent-device-ios-touchid-command-failed-test-',
    `#!/bin/sh
if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "-j" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"udid":"sim-1","state":"Booted"}]}}
JSON
  exit 0
fi
echo "Failed to boot simulator service" >&2
exit 1
`,
    async () => {
      const device: DeviceInfo = {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone Sim',
        kind: 'simulator',
        booted: true,
      };
      await assert.rejects(
        () => setIosSetting(device, 'touchid', 'match'),
        (error: unknown) => {
          assert.equal(error instanceof AppError, true);
          assert.equal((error as AppError).code, 'COMMAND_FAILED');
          assert.match((error as AppError).message, /Failed to simulate touchid/);
          return true;
        },
      );
    },
  );
});

test('setIosSetting appearance dark uses simctl ui appearance', async () => {
  await withMockedXcrun(
    'agent-device-ios-appearance-dark-test-',
    `#!/bin/sh
printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "-j" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"udid":"sim-1","state":"Booted"}]}}
JSON
  exit 0
fi
if [ "$1" = "simctl" ] && [ "$2" = "ui" ] && [ "$3" = "sim-1" ] && [ "$4" = "appearance" ] && [ "$5" = "dark" ]; then
  exit 0
fi
echo "unexpected xcrun args: $@" >&2
exit 1
`,
    async ({ argsLogPath }) => {
      const device: DeviceInfo = {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone Sim',
        kind: 'simulator',
        booted: true,
      };
      await setIosSetting(device, 'appearance', 'dark');
      const lines = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
      const logged = lines.join(' ');
      assert.match(logged, /simctl ui sim-1 appearance dark/);
    },
  );
});

test('setIosSetting appearance dark uses osascript on macOS', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-device-macos-appearance-dark-test-'),
  );
  const osascriptPath = path.join(tmpDir, 'osascript');
  const argsLogPath = path.join(tmpDir, 'args.log');
  await fs.writeFile(
    osascriptPath,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    'utf8',
  );
  await fs.chmod(osascriptPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

  try {
    await setIosSetting(MACOS_TEST_DEVICE, 'appearance', 'dark');
    const logged = await fs.readFile(argsLogPath, 'utf8');
    assert.match(logged, /set dark mode to true/);
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
    else process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('setIosSetting appearance toggle queries current osascript appearance on macOS', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-device-macos-appearance-toggle-test-'),
  );
  const osascriptPath = path.join(tmpDir, 'osascript');
  const argsLogPath = path.join(tmpDir, 'args.log');
  await fs.writeFile(
    osascriptPath,
    [
      '#!/bin/sh',
      'printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'case "$2" in',
      '  *"get dark mode"*)',
      '    echo "true"',
      '    exit 0',
      '    ;;',
      '  *"set dark mode to false"*)',
      '    exit 0',
      '    ;;',
      'esac',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(osascriptPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

  try {
    await setIosSetting(MACOS_TEST_DEVICE, 'appearance', 'toggle');
    const logged = await fs.readFile(argsLogPath, 'utf8');
    assert.match(logged, /get dark mode/);
    assert.match(logged, /set dark mode to false/);
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
    else process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('setIosSetting permission grant accessibility uses macOS helper', async () => {
  await withMockedMacOsHelper(
    [
      '#!/bin/sh',
      'printf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"',
      "cat <<'JSON'",
      '{"ok":true,"data":{"target":"accessibility","action":"grant","granted":true,"requested":true,"openedSettings":false}}',
      'JSON',
      '',
    ].join('\n'),
    async ({ tmpDir }) => {
      const argsLogPath = path.join(tmpDir, 'args.log');
      const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

      try {
        const result = await setIosSetting(MACOS_TEST_DEVICE, 'permission', 'grant', undefined, {
          permissionTarget: 'accessibility',
        });
        const logged = await fs.readFile(argsLogPath, 'utf8');
        assert.equal(logged, 'permission\ngrant\naccessibility\n');
        assert.deepEqual(result, {
          action: 'grant',
          granted: true,
          openedSettings: false,
          requested: true,
          target: 'accessibility',
        });
      } finally {
        if (previousArgsFile === undefined) delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
        else process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
      }
    },
    { tempPrefix: 'agent-device-macos-permission-grant-test-' },
  );
});

test('setIosSetting rejects unsupported macOS permission deny action', async () => {
  await assert.rejects(
    () =>
      setIosSetting(MACOS_TEST_DEVICE, 'permission', 'deny', undefined, {
        permissionTarget: 'accessibility',
      }),
    (error: unknown) => {
      assert.equal(error instanceof AppError, true);
      assert.equal((error as AppError).code, 'INVALID_ARGS');
      assert.match((error as AppError).message, /Unsupported macOS permission action/i);
      return true;
    },
  );
});

test('setIosSetting rejects unsupported macOS wifi setting with explicit subset guidance', async () => {
  await assert.rejects(
    () => setIosSetting(MACOS_TEST_DEVICE, 'wifi', 'on'),
    (error: unknown) => {
      assert.equal(error instanceof AppError, true);
      assert.equal((error as AppError).code, 'INVALID_ARGS');
      assert.match((error as AppError).message, /Unsupported macOS setting: wifi/i);
      assert.match(
        (error as AppError).message,
        /wifi\|airplane\|location remain unsupported on macOS/i,
      );
      return true;
    },
  );
});

test('setIosSetting appearance toggle flips current simulator appearance', async () => {
  await withMockedXcrun(
    'agent-device-ios-appearance-toggle-test-',
    `#!/bin/sh
printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "-j" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"udid":"sim-1","state":"Booted"}]}}
JSON
  exit 0
fi
if [ "$1" = "simctl" ] && [ "$2" = "ui" ] && [ "$3" = "sim-1" ] && [ "$4" = "appearance" ] && [ -z "$5" ]; then
  echo "dark"
  exit 0
fi
if [ "$1" = "simctl" ] && [ "$2" = "ui" ] && [ "$3" = "sim-1" ] && [ "$4" = "appearance" ] && [ "$5" = "light" ]; then
  exit 0
fi
echo "unexpected xcrun args: $@" >&2
exit 1
`,
    async ({ argsLogPath }) => {
      const device: DeviceInfo = {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone Sim',
        kind: 'simulator',
        booted: true,
      };
      await setIosSetting(device, 'appearance', 'toggle');
      const lines = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
      const logged = lines.join(' ');
      assert.match(logged, /simctl ui sim-1 appearance/);
      assert.match(logged, /simctl ui sim-1 appearance light/);
    },
  );
});

test('setIosSetting appearance toggle rejects unsupported current appearance output', async () => {
  await withMockedXcrun(
    'agent-device-ios-appearance-toggle-unsupported-test-',
    `#!/bin/sh
if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "-j" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"udid":"sim-1","state":"Booted"}]}}
JSON
  exit 0
fi
if [ "$1" = "simctl" ] && [ "$2" = "ui" ] && [ "$3" = "sim-1" ] && [ "$4" = "appearance" ] && [ -z "$5" ]; then
  echo "unsupported"
  exit 0
fi
exit 0
`,
    async () => {
      const device: DeviceInfo = {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone Sim',
        kind: 'simulator',
        booted: true,
      };
      await assert.rejects(
        () => setIosSetting(device, 'appearance', 'toggle'),
        (error: unknown) => {
          assert.equal(error instanceof AppError, true);
          assert.equal((error as AppError).code, 'COMMAND_FAILED');
          assert.match((error as AppError).message, /Unable to determine current iOS appearance/);
          return true;
        },
      );
    },
  );
});

test('setIosSetting permission grant camera uses simctl privacy', async () => {
  await withMockedXcrun(
    'agent-device-ios-permission-camera-test-',
    `#!/bin/sh
printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "-j" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"udid":"sim-1","state":"Booted"}]}}
JSON
  exit 0
fi
if [ "$1" = "simctl" ] && [ "$2" = "privacy" ] && [ "$3" = "sim-1" ] && [ "$4" = "grant" ] && [ "$5" = "camera" ] && [ "$6" = "com.example.app" ]; then
  exit 0
fi
echo "unexpected xcrun args: $@" >&2
exit 1
`,
    async ({ argsLogPath }) => {
      const device: DeviceInfo = {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone Sim',
        kind: 'simulator',
        booted: true,
      };
      await setIosSetting(device, 'permission', 'grant', 'com.example.app', {
        permissionTarget: 'camera',
      });
      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.match(logged, /simctl\nprivacy\nsim-1\ngrant\ncamera\ncom\.example\.app/);
    },
  );
});

test('setIosSetting permission grant calendar uses simctl privacy calendar target', async () => {
  await withMockedXcrun(
    'agent-device-ios-permission-calendar-test-',
    `#!/bin/sh
printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "-j" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"udid":"sim-1","state":"Booted"}]}}
JSON
  exit 0
fi
if [ "$1" = "simctl" ] && [ "$2" = "privacy" ] && [ "$3" = "sim-1" ] && [ "$4" = "grant" ] && [ "$5" = "calendar" ] && [ "$6" = "com.example.app" ]; then
  exit 0
fi
echo "unexpected xcrun args: $@" >&2
exit 1
`,
    async ({ argsLogPath }) => {
      const device: DeviceInfo = {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone Sim',
        kind: 'simulator',
        booted: true,
      };
      await setIosSetting(device, 'permission', 'grant', 'com.example.app', {
        permissionTarget: 'calendar',
      });
      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.match(logged, /simctl\nprivacy\nsim-1\ngrant\ncalendar\ncom\.example\.app/);
    },
  );
});

test('setIosSetting permission grant photos limited maps to photos-add', async () => {
  await withMockedXcrun(
    'agent-device-ios-permission-photos-test-',
    `#!/bin/sh
printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "-j" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"udid":"sim-1","state":"Booted"}]}}
JSON
  exit 0
fi
if [ "$1" = "simctl" ] && [ "$2" = "privacy" ] && [ "$3" = "sim-1" ] && [ "$4" = "grant" ] && [ "$5" = "photos-add" ] && [ "$6" = "com.example.app" ]; then
  exit 0
fi
echo "unexpected xcrun args: $@" >&2
exit 1
`,
    async ({ argsLogPath }) => {
      const device: DeviceInfo = {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone Sim',
        kind: 'simulator',
        booted: true,
      };
      await setIosSetting(device, 'permission', 'grant', 'com.example.app', {
        permissionTarget: 'photos',
        permissionMode: 'limited',
      });
      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.match(logged, /simctl\nprivacy\nsim-1\ngrant\nphotos-add\ncom\.example\.app/);
    },
  );
});

test('setIosSetting permission rejects mode for non-photos target', async () => {
  await withMockedXcrun(
    'agent-device-ios-permission-mode-validation-test-',
    `#!/bin/sh
if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "-j" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"udid":"sim-1","state":"Booted"}]}}
JSON
  exit 0
fi
echo "unexpected xcrun args: $@" >&2
exit 1
`,
    async () => {
      const device: DeviceInfo = {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone Sim',
        kind: 'simulator',
        booted: true,
      };
      await assert.rejects(
        () =>
          setIosSetting(device, 'permission', 'grant', 'com.example.app', {
            permissionTarget: 'camera',
            permissionMode: 'limited',
          }),
        (error: unknown) => {
          assert.equal(error instanceof AppError, true);
          assert.equal((error as AppError).code, 'INVALID_ARGS');
          assert.match((error as AppError).message, /mode is only supported for photos/i);
          return true;
        },
      );
    },
  );
});

test('setIosSetting permission reset notifications falls back to reset all when direct reset is blocked', async () => {
  await withMockedXcrun(
    'agent-device-ios-permission-notifications-reset-fallback-',
    `#!/bin/sh
printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "-j" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"udid":"sim-1","state":"Booted"}]}}
JSON
  exit 0
fi
if [ "$1" = "simctl" ] && [ "$2" = "privacy" ] && [ "$3" = "sim-1" ] && [ "$4" = "reset" ] && [ "$5" = "notifications" ] && [ "$6" = "com.example.app" ]; then
  echo "Failed to reset access" >&2
  echo "Operation not permitted" >&2
  exit 1
fi
if [ "$1" = "simctl" ] && [ "$2" = "privacy" ] && [ "$3" = "sim-1" ] && [ "$4" = "reset" ] && [ "$5" = "all" ] && [ "$6" = "com.example.app" ]; then
  exit 0
fi
echo "unexpected xcrun args: $@" >&2
exit 1
`,
    async ({ argsLogPath }) => {
      const device: DeviceInfo = {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone Sim',
        kind: 'simulator',
        booted: true,
      };
      await setIosSetting(device, 'permission', 'reset', 'com.example.app', {
        permissionTarget: 'notifications',
      });
      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.match(logged, /simctl\nprivacy\nsim-1\nreset\nnotifications\ncom\.example\.app/);
      assert.match(logged, /simctl\nprivacy\nsim-1\nreset\nall\ncom\.example\.app/);
    },
  );
});

test('setIosSetting permission deny notifications returns unsupported on runtimes that block it', async () => {
  await withMockedXcrun(
    'agent-device-ios-permission-notifications-deny-unsupported-',
    `#!/bin/sh
# AGENT_DEVICE_CUSTOM_PRIVACY_HELP
printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
if [ "$1" = "simctl" ] && [ "$2" = "privacy" ] && [ "$3" = "help" ]; then
  cat <<'HELP'
Usage: simctl privacy <device> <action> <service> [<bundle identifier>]

        service
             The service:
                 notifications - Allow access to notifications.
                 camera - Allow access to camera.
HELP
  exit 0
fi
if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "-j" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"udid":"sim-1","state":"Booted"}]}}
JSON
  exit 0
fi
if [ "$1" = "simctl" ] && [ "$2" = "privacy" ] && [ "$3" = "sim-1" ] && [ "$4" = "revoke" ] && [ "$5" = "notifications" ] && [ "$6" = "com.example.app" ]; then
  echo "Failed to revoke access" >&2
  echo "Operation not permitted" >&2
  exit 1
fi
echo "unexpected xcrun args: $@" >&2
exit 1
`,
    async ({ argsLogPath }) => {
      const device: DeviceInfo = {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone Sim',
        kind: 'simulator',
        booted: true,
      };
      await assert.rejects(
        () =>
          setIosSetting(device, 'permission', 'deny', 'com.example.app', {
            permissionTarget: 'notifications',
          }),
        (error: unknown) => {
          assert.equal(error instanceof AppError, true);
          assert.equal((error as AppError).code, 'UNSUPPORTED_OPERATION');
          assert.match(
            (error as AppError).message,
            /does not support setting notifications permission/i,
          );
          return true;
        },
      );
      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.match(logged, /simctl\nprivacy\nsim-1\nrevoke\nnotifications\ncom\.example\.app/);
    },
  );
});

test('setIosSetting permission rejects service missing from simctl privacy help', async () => {
  await withMockedXcrun(
    'agent-device-ios-permission-service-unsupported-',
    `#!/bin/sh
# AGENT_DEVICE_CUSTOM_PRIVACY_HELP
printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"
if [ "$1" = "simctl" ] && [ "$2" = "privacy" ] && [ "$3" = "help" ]; then
  cat <<'HELP'
Usage: simctl privacy <device> <action> <service> [<bundle identifier>]

        service
             The service:
                 camera - Allow access to camera.
                 microphone - Allow access to audio input.
HELP
  exit 0
fi
if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$3" = "devices" ] && [ "$4" = "-j" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"udid":"sim-1","state":"Booted"}]}}
JSON
  exit 0
fi
echo "unexpected xcrun args: $@" >&2
exit 1
`,
    async ({ argsLogPath }) => {
      const device: DeviceInfo = {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone Sim',
        kind: 'simulator',
        booted: true,
      };
      await assert.rejects(
        () =>
          setIosSetting(device, 'permission', 'grant', 'com.example.app', {
            permissionTarget: 'calendar',
          }),
        (error: unknown) => {
          assert.equal(error instanceof AppError, true);
          assert.equal((error as AppError).code, 'UNSUPPORTED_OPERATION');
          assert.match((error as AppError).message, /does not support service "calendar"/i);
          return true;
        },
      );
      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.match(logged, /simctl\nprivacy\nhelp/);
      assert.doesNotMatch(logged, /simctl\nprivacy\nsim-1\ngrant\ncalendar/);
    },
  );
});
