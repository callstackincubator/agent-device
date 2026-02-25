import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  listIosApps,
  openIosApp,
  parseIosDeviceAppsPayload,
  pushIosNotification,
  readIosClipboardText,
  reinstallIosApp,
  resolveIosApp,
  setIosSetting,
  writeIosClipboardText,
} from '../index.ts';
import { shouldFallbackToRunnerForIosScreenshot } from '../apps.ts';
import type { DeviceInfo } from '../../../utils/device.ts';
import { AppError } from '../../../utils/errors.ts';

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
    const args = (await fs.readFile(argsLogPath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean);
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
    const args = (await fs.readFile(argsLogPath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean);
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
    const args = (await fs.readFile(argsLogPath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean);
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
    await fs.writeFile(appPath, 'placeholder', 'utf8');
    const result = await reinstallIosApp(device, 'Demo', appPath);
    assert.equal(result.bundleId, 'com.example.demo');

    const args = (await fs.readFile(argsLogPath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean);

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
    await fs.writeFile(appPath, 'placeholder', 'utf8');
    const result = await reinstallIosApp(device, 'Demo', appPath);
    assert.equal(result.bundleId, 'com.example.demo');

    const args = (await fs.readFile(argsLogPath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean);
    assert.equal(args.includes('uninstall'), true);
    assert.equal(args.includes('install'), true);
    },
  );
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
    const args = (await fs.readFile(argsLogPath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean);
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
    const args = (await fs.readFile(argsLogPath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean);
    assert.equal(args[0], 'simctl');
    assert.equal(args[1], 'push');
    assert.equal(args[2], 'sim-1');
    assert.equal(args[3], 'com.example.app');
    assert.match(args[4] ?? '', /payload\.apns$/);
    const payload = JSON.parse(await fs.readFile(payloadCapturePath, 'utf8')) as { aps: { alert: string; badge: number } };
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
      apps: [
        null,
        {},
        { name: 'Missing bundle id' },
        { bundleIdentifier: '' },
      ],
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
      "  cat > \"$out\" <<'JSON'",
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
      const lines = (await fs.readFile(argsLogPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean);
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
      const lines = (await fs.readFile(argsLogPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean);
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
      const lines = (await fs.readFile(argsLogPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean);
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
      const lines = (await fs.readFile(argsLogPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean);
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
      const lines = (await fs.readFile(argsLogPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean);
      const logged = lines.join(' ');
      assert.match(logged, /simctl ui sim-1 appearance dark/);
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
      const lines = (await fs.readFile(argsLogPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean);
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
          assert.match((error as AppError).message, /does not support setting notifications permission/i);
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
