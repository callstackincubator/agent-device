import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseArgs, usage, usageForCommand } from '../args.ts';
import { AppError } from '../errors.ts';
import { getCliCommandNames, getSchemaCapabilityKeys } from '../command-schema.ts';
import { listCapabilityCommands } from '../../core/capabilities.ts';

test('parseArgs recognizes command-specific flag combinations', async () => {
  const scenarios: Array<{
    label: string;
    argv: string[];
    strictFlags?: boolean;
    assertParsed: (parsed: ReturnType<typeof parseArgs>) => void;
  }> = [
    {
      label: 'open --relaunch',
      argv: ['open', 'settings', '--relaunch'],
      assertParsed: (parsed) => {
        assert.equal(parsed.command, 'open');
        assert.deepEqual(parsed.positionals, ['settings']);
        assert.equal(parsed.flags.relaunch, true);
      },
    },
    {
      label: 'open --platform ios --target tv',
      argv: ['open', 'Settings', '--platform', 'ios', '--target', 'tv'],
      strictFlags: true,
      assertParsed: (parsed) => {
        assert.equal(parsed.command, 'open');
        assert.equal(parsed.flags.platform, 'ios');
        assert.equal(parsed.flags.target, 'tv');
      },
    },
    {
      label: 'boot --headless on android',
      argv: ['boot', '--platform', 'android', '--device', 'Pixel_9_Pro_XL', '--headless'],
      strictFlags: true,
      assertParsed: (parsed) => {
        assert.equal(parsed.command, 'boot');
        assert.equal(parsed.flags.platform, 'android');
        assert.equal(parsed.flags.device, 'Pixel_9_Pro_XL');
        assert.equal(parsed.flags.headless, true);
      },
    },
    {
      label: 'back --in-app',
      argv: ['back', '--in-app'],
      strictFlags: true,
      assertParsed: (parsed) => {
        assert.equal(parsed.command, 'back');
        assert.equal(parsed.flags.backMode, 'in-app');
      },
    },
    {
      label: 'back --system',
      argv: ['back', '--system'],
      strictFlags: true,
      assertParsed: (parsed) => {
        assert.equal(parsed.command, 'back');
        assert.equal(parsed.flags.backMode, 'system');
      },
    },
    {
      label: 'open --platform apple alias',
      argv: ['open', 'Settings', '--platform', 'apple', '--target', 'tv'],
      strictFlags: true,
      assertParsed: (parsed) => {
        assert.equal(parsed.command, 'open');
        assert.equal(parsed.flags.platform, 'apple');
        assert.equal(parsed.flags.target, 'tv');
      },
    },
    {
      label: 'open --surface frontmost-app',
      argv: ['open', '--platform', 'macos', '--surface', 'frontmost-app'],
      strictFlags: true,
      assertParsed: (parsed) => {
        assert.equal(parsed.command, 'open');
        assert.equal(parsed.flags.platform, 'macos');
        assert.equal(parsed.flags.surface, 'frontmost-app');
      },
    },
    {
      label: 'test suite with retries, timeout, artifacts, fail-fast, and replay update',
      argv: [
        'test',
        './suite',
        '--platform',
        'android',
        '--fail-fast',
        '--update',
        '--timeout',
        '60000',
        '--retries',
        '2',
        '--artifacts-dir',
        '.agent-device/test-artifacts',
      ],
      strictFlags: true,
      assertParsed: (parsed) => {
        assert.equal(parsed.command, 'test');
        assert.deepEqual(parsed.positionals, ['./suite']);
        assert.equal(parsed.flags.platform, 'android');
        assert.equal(parsed.flags.failFast, true);
        assert.equal(parsed.flags.replayUpdate, true);
        assert.equal(parsed.flags.timeoutMs, 60000);
        assert.equal(parsed.flags.retries, 2);
        assert.equal(parsed.flags.artifactsDir, '.agent-device/test-artifacts');
      },
    },
  ];

  for (const scenario of scenarios) {
    scenario.assertParsed(parseArgs(scenario.argv, { strictFlags: scenario.strictFlags }));
  }
});

test('parseArgs recognizes device isolation flags', () => {
  const parsed = parseArgs(
    [
      'devices',
      '--platform',
      'ios',
      '--ios-simulator-device-set',
      '/tmp/tenant-a/simulators',
      '--android-device-allowlist',
      'emulator-5554,device-1234',
    ],
    { strictFlags: true },
  );
  assert.equal(parsed.command, 'devices');
  assert.equal(parsed.flags.platform, 'ios');
  assert.equal(parsed.flags.iosSimulatorDeviceSet, '/tmp/tenant-a/simulators');
  assert.equal(parsed.flags.androidDeviceAllowlist, 'emulator-5554,device-1234');
});

test('parseArgs rejects test retries above the supported ceiling', () => {
  assert.throws(
    () => parseArgs(['test', './suite', '--retries', '4'], { strictFlags: true }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /Invalid retries: 4/.test(error.message),
  );
});

test('parseArgs recognizes logs clear --restart', () => {
  const parsed = parseArgs(['logs', 'clear', '--restart'], { strictFlags: true });
  assert.equal(parsed.command, 'logs');
  assert.deepEqual(parsed.positionals, ['clear']);
  assert.equal(parsed.flags.restart, true);
});

test('parseArgs recognizes network dump arguments', () => {
  const parsed = parseArgs(['network', 'dump', '20', 'headers'], { strictFlags: true });
  assert.equal(parsed.command, 'network');
  assert.deepEqual(parsed.positionals, ['dump', '20', 'headers']);
});

test('parseArgs recognizes network include flag', () => {
  const parsed = parseArgs(['network', 'dump', '20', '--include', 'headers'], {
    strictFlags: true,
  });
  assert.equal(parsed.command, 'network');
  assert.deepEqual(parsed.positionals, ['dump', '20']);
  assert.equal(parsed.flags.networkInclude, 'headers');
});

test('parseArgs preserves react-devtools arguments as passthrough positionals', () => {
  const parsed = parseArgs(
    [
      'react-devtools',
      'profile',
      'diff',
      '--threshold',
      '10',
      '--limit=5',
      '--json',
      '--session',
      'rn',
    ],
    { strictFlags: true },
  );
  assert.equal(parsed.command, 'react-devtools');
  assert.equal(parsed.flags.json, true);
  assert.equal(parsed.flags.session, 'rn');
  assert.deepEqual(parsed.positionals, ['profile', 'diff', '--threshold', '10', '--limit=5']);
});

test('parseArgs supports explicit passthrough boundary for react-devtools global flag names', () => {
  const parsed = parseArgs(['react-devtools', '--', 'status', '--json'], { strictFlags: true });
  assert.equal(parsed.command, 'react-devtools');
  assert.equal(parsed.flags.json, false);
  assert.deepEqual(parsed.positionals, ['status', '--json']);
});

test('parseArgs accepts push with payload file', () => {
  const parsed = parseArgs(['push', 'com.example.app', './payload.json'], { strictFlags: true });
  assert.equal(parsed.command, 'push');
  assert.deepEqual(parsed.positionals, ['com.example.app', './payload.json']);
});

test('parseArgs accepts install command args', () => {
  const parsed = parseArgs(['install', 'com.example.app', './build/app.apk'], {
    strictFlags: true,
  });
  assert.equal(parsed.command, 'install');
  assert.deepEqual(parsed.positionals, ['com.example.app', './build/app.apk']);
});

test('parseArgs accepts install-from-source url and repeated headers', () => {
  const parsed = parseArgs(
    [
      'install-from-source',
      'https://example.com/builds/app.apk',
      '--header',
      'authorization: Bearer token',
      '--header',
      'x-build-id: 42',
      '--retain-paths',
      '--retention-ms',
      '60000',
    ],
    { strictFlags: true },
  );
  assert.equal(parsed.command, 'install-from-source');
  assert.deepEqual(parsed.positionals, ['https://example.com/builds/app.apk']);
  assert.deepEqual(parsed.flags.header, ['authorization: Bearer token', 'x-build-id: 42']);
  assert.equal(parsed.flags.retainPaths, true);
  assert.equal(parsed.flags.retentionMs, 60000);
});

test('parseArgs accepts install-from-source GitHub Actions artifact flag', () => {
  const parsed = parseArgs(
    [
      'install-from-source',
      '--github-actions-artifact',
      'thymikee/RNCLI83:6635342232',
      '--platform',
      'android',
    ],
    { strictFlags: true },
  );
  assert.equal(parsed.command, 'install-from-source');
  assert.deepEqual(parsed.positionals, []);
  assert.equal(parsed.flags.githubActionsArtifact, 'thymikee/RNCLI83:6635342232');
  assert.equal(parsed.flags.platform, 'android');
});

test('parseArgs accepts metro prepare arguments', () => {
  const parsed = parseArgs(
    [
      'metro',
      'prepare',
      '--project-root',
      './apps/demo',
      '--public-base-url',
      'https://sandbox.example.test',
      '--proxy-base-url',
      'https://proxy.example.test',
      '--bearer-token',
      'secret',
      '--port',
      '9090',
      '--kind',
      'expo',
      '--runtime-file',
      './.agent-device/metro-runtime.json',
      '--no-reuse-existing',
      '--no-install-deps',
    ],
    { strictFlags: true },
  );

  assert.equal(parsed.command, 'metro');
  assert.deepEqual(parsed.positionals, ['prepare']);
  assert.equal(parsed.flags.metroProjectRoot, './apps/demo');
  assert.equal(parsed.flags.metroPublicBaseUrl, 'https://sandbox.example.test');
  assert.equal(parsed.flags.metroProxyBaseUrl, 'https://proxy.example.test');
  assert.equal(parsed.flags.metroBearerToken, 'secret');
  assert.equal(parsed.flags.metroPreparePort, 9090);
  assert.equal(parsed.flags.metroKind, 'expo');
  assert.equal(parsed.flags.metroRuntimeFile, './.agent-device/metro-runtime.json');
  assert.equal(parsed.flags.metroNoReuseExisting, true);
  assert.equal(parsed.flags.metroNoInstallDeps, true);
});

test('parseArgs accepts metro reload arguments', () => {
  const parsed = parseArgs(
    [
      'metro',
      'reload',
      '--metro-host',
      '127.0.0.1',
      '--metro-port',
      '9090',
      '--bundle-url',
      'http://127.0.0.1:9090/index.bundle?platform=ios',
      '--probe-timeout-ms',
      '1500',
    ],
    { strictFlags: true },
  );

  assert.equal(parsed.command, 'metro');
  assert.deepEqual(parsed.positionals, ['reload']);
  assert.equal(parsed.flags.metroHost, '127.0.0.1');
  assert.equal(parsed.flags.metroPort, 9090);
  assert.equal(parsed.flags.bundleUrl, 'http://127.0.0.1:9090/index.bundle?platform=ios');
  assert.equal(parsed.flags.metroProbeTimeoutMs, 1500);
});

test('parseArgs accepts remote workflow profile flag', () => {
  const parsed = parseArgs(
    [
      'connect',
      '--remote-config',
      './agent-device.remote.json',
      '--tenant',
      'acme',
      '--run-id',
      'run-1',
    ],
    {
      strictFlags: true,
    },
  );
  assert.equal(parsed.command, 'connect');
  assert.deepEqual(parsed.positionals, []);
  assert.equal(parsed.flags.remoteConfig, './agent-device.remote.json');
});

test('parseArgs accepts clipboard subcommands', () => {
  const read = parseArgs(['clipboard', 'read'], { strictFlags: true });
  assert.equal(read.command, 'clipboard');
  assert.deepEqual(read.positionals, ['read']);

  const write = parseArgs(['clipboard', 'write', 'otp', '123456'], { strictFlags: true });
  assert.equal(write.command, 'clipboard');
  assert.deepEqual(write.positionals, ['write', 'otp', '123456']);
});

test('parseArgs accepts keyboard subcommands', () => {
  const status = parseArgs(['keyboard', 'status'], { strictFlags: true });
  assert.equal(status.command, 'keyboard');
  assert.deepEqual(status.positionals, ['status']);

  const dismiss = parseArgs(['keyboard', 'dismiss'], { strictFlags: true });
  assert.equal(dismiss.command, 'keyboard');
  assert.deepEqual(dismiss.positionals, ['dismiss']);
});

test('parseArgs accepts scroll pixel distance flag', () => {
  const parsed = parseArgs(['scroll', 'down', '--pixels', '240'], { strictFlags: true });
  assert.equal(parsed.command, 'scroll');
  assert.deepEqual(parsed.positionals, ['down']);
  assert.equal(parsed.flags.pixels, 240);
});

test('parseArgs recognizes --debug alias for verbose mode', () => {
  const parsed = parseArgs(['open', 'settings', '--debug']);
  assert.equal(parsed.command, 'open');
  assert.deepEqual(parsed.positionals, ['settings']);
  assert.equal(parsed.flags.verbose, true);
});

test('parseArgs recognizes daemon transport/state/tenant isolation flags', () => {
  const parsed = parseArgs(
    [
      'open',
      'settings',
      '--state-dir',
      './tmp/ad-state',
      '--daemon-base-url',
      'https://remote-mac.example.test:7777/agent-device',
      '--daemon-auth-token',
      'remote-secret',
      '--daemon-transport',
      'http',
      '--daemon-server-mode',
      'dual',
      '--tenant',
      'team_alpha',
      '--session-isolation',
      'tenant',
      '--run-id',
      'run_42',
      '--lease-id',
      'abcd1234ef567890',
    ],
    { strictFlags: true },
  );
  assert.equal(parsed.flags.stateDir, './tmp/ad-state');
  assert.equal(parsed.flags.daemonBaseUrl, 'https://remote-mac.example.test:7777/agent-device');
  assert.equal(parsed.flags.daemonAuthToken, 'remote-secret');
  assert.equal(parsed.flags.daemonTransport, 'http');
  assert.equal(parsed.flags.daemonServerMode, 'dual');
  assert.equal(parsed.flags.tenant, 'team_alpha');
  assert.equal(parsed.flags.sessionIsolation, 'tenant');
  assert.equal(parsed.flags.runId, 'run_42');
  assert.equal(parsed.flags.leaseId, 'abcd1234ef567890');
});

test('parseArgs recognizes connect lease backend force and no-login flags', () => {
  const parsed = parseArgs(
    [
      'connect',
      '--remote-config',
      './remote.json',
      '--tenant',
      'acme',
      '--run-id',
      'run-123',
      '--lease-backend',
      'android-instance',
      '--force',
      '--no-login',
    ],
    { strictFlags: true },
  );
  assert.equal(parsed.command, 'connect');
  assert.equal(parsed.flags.remoteConfig, './remote.json');
  assert.equal(parsed.flags.leaseBackend, 'android-instance');
  assert.equal(parsed.flags.force, true);
  assert.equal(parsed.flags.noLogin, true);
});

test('parseArgs accepts auth management subcommands', () => {
  const status = parseArgs(['auth', 'status'], { strictFlags: true });
  assert.equal(status.command, 'auth');
  assert.deepEqual(status.positionals, ['status']);

  const login = parseArgs(['auth', 'login', '--remote-config', './remote.json'], {
    strictFlags: true,
  });
  assert.equal(login.command, 'auth');
  assert.deepEqual(login.positionals, ['login']);
  assert.equal(login.flags.remoteConfig, './remote.json');
});

test('parseArgs recognizes explicit config file flag', () => {
  const parsed = parseArgs(['open', 'settings', '--config', './agent-device.json'], {
    strictFlags: true,
  });
  assert.equal(parsed.command, 'open');
  assert.equal(parsed.flags.config, './agent-device.json');
});

test('parseArgs recognizes session lock policy flag', () => {
  const parsed = parseArgs(['snapshot', '--session-lock', 'strip'], { strictFlags: true });
  assert.equal(parsed.command, 'snapshot');
  assert.equal(parsed.flags.sessionLock, 'strip');
});

test('parseArgs keeps deprecated session lock aliases for compatibility', () => {
  const parsed = parseArgs(['snapshot', '--session-locked', '--session-lock-conflicts', 'strip'], {
    strictFlags: true,
  });
  assert.equal(parsed.command, 'snapshot');
  assert.equal(parsed.flags.sessionLocked, true);
  assert.equal(parsed.flags.sessionLockConflicts, 'strip');
});

test('batch requires exactly one step source', () => {
  assert.throws(
    () => parseArgs(['batch'], { strictFlags: true }),
    /requires exactly one step source/,
  );
  assert.throws(
    () =>
      parseArgs(['batch', '--steps', '[]', '--steps-file', './steps.json'], { strictFlags: true }),
    /requires exactly one step source/,
  );
  const inline = parseArgs(['batch', '--steps', '[]'], { strictFlags: true });
  assert.equal(inline.command, 'batch');
  assert.equal(inline.flags.steps, '[]');
  assert.throws(
    () => parseArgs(['batch', '--steps', '[]', '--on-error', 'continue'], { strictFlags: true }),
    /Invalid on-error: continue/,
  );
});

test('parseArgs accepts --save-script with optional path value', () => {
  const withoutPath = parseArgs(['open', 'settings', '--save-script']);
  assert.equal(withoutPath.command, 'open');
  assert.deepEqual(withoutPath.positionals, ['settings']);
  assert.equal(withoutPath.flags.saveScript, true);

  const withPath = parseArgs(['open', 'settings', '--save-script', './workflows/my-flow.ad']);
  assert.equal(withPath.command, 'open');
  assert.deepEqual(withPath.positionals, ['settings']);
  assert.equal(withPath.flags.saveScript, './workflows/my-flow.ad');

  const nonPathPositional = parseArgs(['open', '--save-script', 'settings']);
  assert.equal(nonPathPositional.command, 'open');
  assert.deepEqual(nonPathPositional.positionals, ['settings']);
  assert.equal(nonPathPositional.flags.saveScript, true);

  const inlineValue = parseArgs(['open', 'settings', '--save-script=my-flow.ad']);
  assert.equal(inlineValue.command, 'open');
  assert.deepEqual(inlineValue.positionals, ['settings']);
  assert.equal(inlineValue.flags.saveScript, 'my-flow.ad');

  const ambiguousBareValue = parseArgs(['open', '--save-script', 'my-flow.ad']);
  assert.equal(ambiguousBareValue.command, 'open');
  assert.deepEqual(ambiguousBareValue.positionals, ['my-flow.ad']);
  assert.equal(ambiguousBareValue.flags.saveScript, true);
});

test('parseArgs recognizes press series flags', () => {
  const parsed = parseArgs([
    'press',
    '300',
    '500',
    '--count',
    '12',
    '--interval-ms=45',
    '--hold-ms',
    '120',
    '--jitter-px',
    '3',
  ]);
  assert.equal(parsed.command, 'press');
  assert.deepEqual(parsed.positionals, ['300', '500']);
  assert.equal(parsed.flags.count, 12);
  assert.equal(parsed.flags.intervalMs, 45);
  assert.equal(parsed.flags.holdMs, 120);
  assert.equal(parsed.flags.jitterPx, 3);
});

test('parseArgs recognizes press selector + snapshot flags', () => {
  const parsed = parseArgs(['press', '@e2', '--depth', '3', '--scope', 'Sign In', '--raw'], {
    strictFlags: true,
  });
  assert.equal(parsed.command, 'press');
  assert.deepEqual(parsed.positionals, ['@e2']);
  assert.equal(parsed.flags.snapshotDepth, 3);
  assert.equal(parsed.flags.snapshotScope, 'Sign In');
  assert.equal(parsed.flags.snapshotRaw, true);
});

test('parseArgs recognizes click series flags', () => {
  const parsed = parseArgs(['click', '@e5', '--count', '4', '--interval-ms', '10'], {
    strictFlags: true,
  });
  assert.equal(parsed.command, 'click');
  assert.deepEqual(parsed.positionals, ['@e5']);
  assert.equal(parsed.flags.count, 4);
  assert.equal(parsed.flags.intervalMs, 10);
});

test('parseArgs recognizes click button flag', () => {
  const parsed = parseArgs(['click', '@e5', '--button', 'secondary'], {
    strictFlags: true,
  });
  assert.equal(parsed.command, 'click');
  assert.deepEqual(parsed.positionals, ['@e5']);
  assert.equal(parsed.flags.clickButton, 'secondary');
});

test('parseArgs recognizes double-tap flag for repeated press', () => {
  const parsed = parseArgs(['press', '201', '545', '--count', '5', '--double-tap'], {
    strictFlags: true,
  });
  assert.equal(parsed.command, 'press');
  assert.deepEqual(parsed.positionals, ['201', '545']);
  assert.equal(parsed.flags.count, 5);
  assert.equal(parsed.flags.doubleTap, true);
});

test('parseArgs recognizes swipe positional + pattern flags', () => {
  const parsed = parseArgs([
    'swipe',
    '540',
    '1500',
    '540',
    '500',
    '120',
    '--count',
    '8',
    '--pause-ms',
    '30',
    '--pattern',
    'ping-pong',
  ]);
  assert.equal(parsed.command, 'swipe');
  assert.deepEqual(parsed.positionals, ['540', '1500', '540', '500', '120']);
  assert.equal(parsed.flags.count, 8);
  assert.equal(parsed.flags.pauseMs, 30);
  assert.equal(parsed.flags.pattern, 'ping-pong');
});

test('parseArgs recognizes type and fill delay flags', () => {
  const typeParsed = parseArgs(['type', 'hello', '--delay-ms', '75'], {
    strictFlags: true,
  });
  assert.equal(typeParsed.command, 'type');
  assert.deepEqual(typeParsed.positionals, ['hello']);
  assert.equal(typeParsed.flags.delayMs, 75);

  const fillParsed = parseArgs(['fill', '@e5', 'search', '--delay-ms', '40'], {
    strictFlags: true,
  });
  assert.equal(fillParsed.command, 'fill');
  assert.deepEqual(fillParsed.positionals, ['@e5', 'search']);
  assert.equal(fillParsed.flags.delayMs, 40);
});

test('parseArgs recognizes record --fps flag', () => {
  const parsed = parseArgs(['record', 'start', './capture.mp4', '--fps', '30'], {
    strictFlags: true,
  });
  assert.equal(parsed.command, 'record');
  assert.deepEqual(parsed.positionals, ['start', './capture.mp4']);
  assert.equal(parsed.flags.fps, 30);
});

test('parseArgs recognizes record --quality flag', () => {
  const parsed = parseArgs(['record', 'start', './capture.mp4', '--quality', '7'], {
    strictFlags: true,
  });
  assert.equal(parsed.command, 'record');
  assert.deepEqual(parsed.positionals, ['start', './capture.mp4']);
  assert.equal(parsed.flags.quality, 7);
});

test('parseArgs accepts record --quality boundaries', () => {
  const parsedMin = parseArgs(['record', 'start', './capture.mp4', '--quality', '5'], {
    strictFlags: true,
  });
  assert.equal(parsedMin.flags.quality, 5);
  const parsedMax = parseArgs(['record', 'start', './capture.mp4', '--quality', '10'], {
    strictFlags: true,
  });
  assert.equal(parsedMax.flags.quality, 10);
});

test('parseArgs recognizes record --hide-touches flag', () => {
  const parsed = parseArgs(['record', 'start', './capture.mp4', '--hide-touches'], {
    strictFlags: true,
  });
  assert.equal(parsed.command, 'record');
  assert.deepEqual(parsed.positionals, ['start', './capture.mp4']);
  assert.equal(parsed.flags.hideTouches, true);
});

test('parseArgs recognizes screenshot --fullscreen flag', () => {
  const parsed = parseArgs(['screenshot', 'page.png', '--fullscreen', '--max-size', '1024'], {
    strictFlags: true,
  });
  assert.equal(parsed.command, 'screenshot');
  assert.deepEqual(parsed.positionals, ['page.png']);
  assert.equal(parsed.flags.screenshotFullscreen, true);
  assert.equal(parsed.flags.screenshotMaxSize, 1024);
});

test('parseArgs rejects invalid record --fps range', () => {
  assert.throws(
    () => parseArgs(['record', 'start', './capture.mp4', '--fps', '0'], { strictFlags: true }),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      error.message === 'Invalid fps: 0',
  );
});

test('parseArgs rejects invalid record --quality range', () => {
  assert.throws(
    () => parseArgs(['record', 'start', './capture.mp4', '--quality', '4'], { strictFlags: true }),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      error.message === 'Invalid quality: 4',
  );
});

test('parseArgs recognizes longpress command', () => {
  const parsed = parseArgs(['longpress', '300', '500', '800'], { strictFlags: true });
  assert.equal(parsed.command, 'longpress');
  assert.deepEqual(parsed.positionals, ['300', '500', '800']);
});

test('parseArgs supports legacy long-press alias', () => {
  const parsed = parseArgs(['long-press', '300', '500', '800'], { strictFlags: true });
  assert.equal(parsed.command, 'longpress');
  assert.deepEqual(parsed.positionals, ['300', '500', '800']);
});

test('parseArgs supports metrics alias for perf', () => {
  const parsed = parseArgs(['metrics'], { strictFlags: true });
  assert.equal(parsed.command, 'perf');
  assert.deepEqual(parsed.positionals, []);
});

test('parseArgs supports trigger-app-event payload argument', () => {
  const parsed = parseArgs(['trigger-app-event', 'screenshot_taken', '{"source":"qa"}'], {
    strictFlags: true,
  });
  assert.equal(parsed.command, 'trigger-app-event');
  assert.deepEqual(parsed.positionals, ['screenshot_taken', '{"source":"qa"}']);
});

test('parseArgs accepts rotate orientation aliases', () => {
  const parsed = parseArgs(['rotate', 'left'], { strictFlags: true });
  assert.equal(parsed.command, 'rotate');
  assert.deepEqual(parsed.positionals, ['left']);
});

test('usageForCommand resolves longpress help', () => {
  const help = usageForCommand('longpress');
  assert.equal(help === null, false);
  assert.match(help ?? '', /agent-device longpress <x> <y> \[durationMs\]/);
});

test('usageForCommand supports legacy long-press alias', () => {
  const help = usageForCommand('long-press');
  assert.equal(help === null, false);
  assert.match(help ?? '', /agent-device longpress <x> <y> \[durationMs\]/);
  assert.doesNotMatch(help ?? '', /agent-device long-press/);
});

test('usageForCommand supports metrics alias', () => {
  const help = usageForCommand('metrics');
  assert.equal(help === null, false);
  assert.match(help ?? '', /agent-device perf/);
});

test('parseArgs rejects invalid swipe pattern', () => {
  assert.throws(
    () => parseArgs(['swipe', '0', '0', '10', '10', '--pattern', 'diagonal']),
    /Invalid pattern/,
  );
});

test('parseArgs rejects conflicting back mode flags', () => {
  assert.throws(
    () => parseArgs(['back', '--in-app', '--system'], { strictFlags: true }),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      error.message ===
        'back accepts only one explicit mode flag: use either --in-app or --system.',
  );
});

test('usage includes concise top-level commands', () => {
  const usageText = usage();
  assert.match(
    usageText,
    /install-from-source <url> \| install-from-source --github-actions-artifact/,
  );
  assert.match(usageText, /metro prepare --public-base-url <url>/);
  assert.match(usageText, /batch --steps <json> \| --steps-file <path>/);
  assert.match(usageText, /network dump/);
  assert.match(usageText, /clipboard read \| clipboard write <text>/);
  assert.match(usageText, /keyboard \[action\]/);
  assert.match(usageText, /trigger-app-event <event> \[payloadJson\]/);
  assert.match(usageText, /pinch <scale> \[x\] \[y\]/);
  assert.match(usageText, /rotate <orientation>/);
  assert.match(usageText, /record start \[path\] \| record stop/);
  assert.match(usageText, /trace start \[path\] \| trace stop/);
});

test('usage includes only global flags in the top-level flags section', () => {
  const usageText = usage();
  assert.match(usageText, /--target mobile\|tv/);
  assert.match(usageText, /--ios-simulator-device-set <path>/);
  assert.match(usageText, /--android-device-allowlist <serials>/);
  assert.match(usageText, /--state-dir <path>/);
  assert.match(usageText, /--daemon-transport auto\|socket\|http/);
  assert.match(usageText, /--daemon-server-mode socket\|http\|dual/);
  assert.match(usageText, /--tenant <id>/);
  assert.match(usageText, /--session-isolation none\|tenant/);
  assert.match(usageText, /--run-id <id>/);
  assert.match(usageText, /--lease-id <id>/);
  assert.match(usageText, /--lease-backend ios-simulator\|ios-instance\|android-instance/);
  assert.doesNotMatch(usageText, /--relaunch/);
  assert.doesNotMatch(usageText, /--header <name:value>/);
  assert.doesNotMatch(usageText, /--restart/);
  assert.doesNotMatch(usageText, /--fps <n>/);
  assert.doesNotMatch(usageText, /--quality <5-10>/);
  assert.doesNotMatch(usageText, /--save-script \[path\]/);
  assert.doesNotMatch(usageText, /--metadata/);
});

test('usage includes skills, config, environment, and examples footers', () => {
  const usageText = usage();
  assert.match(usageText, /Agent Skills:/);
  assert.match(usageText, /agent-device\s+Canonical mobile automation flows/);
  assert.match(usageText, /dogfood\s+Exploratory QA and bug hunts/);
  assert.match(usageText, /See `skills\/<name>\/SKILL\.md` in the installed package\./);
  assert.match(usageText, /Configuration:/);
  assert.match(
    usageText,
    /Default config files: ~\/\.agent-device\/config\.json, \.\/agent-device\.json/,
  );
  assert.match(
    usageText,
    /Use --config <path> or AGENT_DEVICE_CONFIG to load one explicit config file\./,
  );
  assert.match(usageText, /Environment:/);
  assert.match(usageText, /AGENT_DEVICE_SESSION\s+Default session name/);
  assert.match(usageText, /AGENT_DEVICE_PLATFORM\s+Default platform binding/);
  assert.match(usageText, /AGENT_DEVICE_SESSION_LOCK\s+Bound-session conflict mode/);
  assert.match(usageText, /AGENT_DEVICE_DAEMON_BASE_URL\s+Connect to remote daemon/);
  assert.match(usageText, /Examples:/);
  assert.match(usageText, /agent-device open Settings --platform ios/);
  assert.match(usageText, /agent-device snapshot -i/);
  assert.match(usageText, /agent-device fill @e3 "test@example\.com"/);
  assert.match(usageText, /agent-device replay \.\/session\.ad/);
  assert.match(usageText, /agent-device test \.\/suite --platform android/);
});

test('apps defaults to --all filter and allows overrides', () => {
  const defaultFilter = parseArgs(['apps'], { strictFlags: true });
  assert.equal(defaultFilter.command, 'apps');
  assert.equal(defaultFilter.flags.appsFilter, 'all');

  const userInstalled = parseArgs(['apps', '--user-installed'], { strictFlags: true });
  assert.equal(userInstalled.command, 'apps');
  assert.equal(userInstalled.flags.appsFilter, 'user-installed');
});

test('every capability command has a parser schema entry', () => {
  const schemaCommands = new Set(getCliCommandNames());
  for (const command of listCapabilityCommands()) {
    assert.equal(schemaCommands.has(command), true, `Missing schema for command: ${command}`);
  }
});

test('schema capability mappings match capability source-of-truth', () => {
  assert.deepEqual(getSchemaCapabilityKeys(), listCapabilityCommands());
});

test('compat mode warns and strips unsupported command flags', () => {
  const parsed = parseArgs(['press', '10', '20', '--pause-ms', '2'], { strictFlags: false });
  assert.equal(parsed.command, 'press');
  assert.equal(parsed.flags.pauseMs, undefined);
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0], /not supported for command press/);
});

test('strict mode rejects unsupported pilot-command flags', () => {
  assert.throws(
    () => parseArgs(['press', '10', '20', '--pause-ms', '2'], { strictFlags: true }),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      error.message.includes('not supported for command press'),
  );
});

test('strict mode rejects removed secondary alias', () => {
  assert.throws(
    () => parseArgs(['click', '@e5', '--secondary'], { strictFlags: true }),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      error.message === 'Unknown flag: --secondary',
  );
});

test('strict mode rejects click-only button flag on press', () => {
  assert.throws(
    () => parseArgs(['press', '10', '20', '--button', 'secondary'], { strictFlags: true }),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      error.message.includes('not supported for command press'),
  );
});

test('snapshot command accepts command-specific flags', () => {
  const parsed = parseArgs(['snapshot', '-i', '-c', '--depth', '3', '-s', 'Login'], {
    strictFlags: true,
  });
  assert.equal(parsed.command, 'snapshot');
  assert.equal(parsed.flags.snapshotInteractiveOnly, true);
  assert.equal(parsed.flags.snapshotCompact, true);
  assert.equal(parsed.flags.snapshotDepth, 3);
  assert.equal(parsed.flags.snapshotScope, 'Login');
});

test('snapshot command accepts diff alias flag', () => {
  const parsed = parseArgs(['snapshot', '--diff', '-i', '--depth', '4', '--scope', 'Counter'], {
    strictFlags: true,
  });
  assert.equal(parsed.command, 'diff');
  assert.deepEqual(parsed.positionals, ['snapshot']);
  assert.equal(parsed.flags.snapshotDiff, undefined);
  assert.equal(parsed.flags.snapshotInteractiveOnly, true);
  assert.equal(parsed.flags.snapshotDepth, 4);
  assert.equal(parsed.flags.snapshotScope, 'Counter');
});

test('snapshot --diff --help stays on snapshot command help', () => {
  const parsed = parseArgs(['snapshot', '--diff', '--help'], { strictFlags: true });
  assert.equal(parsed.command, 'snapshot');
  assert.equal(parsed.flags.snapshotDiff, true);
  assert.equal(parsed.flags.help, true);
});

test('diff snapshot command accepts snapshot flags', () => {
  const parsed = parseArgs(
    ['diff', 'snapshot', '-i', '--depth', '4', '--scope', 'Counter', '--raw'],
    { strictFlags: true },
  );
  assert.equal(parsed.command, 'diff');
  assert.deepEqual(parsed.positionals, ['snapshot']);
  assert.equal(parsed.flags.snapshotInteractiveOnly, true);
  assert.equal(parsed.flags.snapshotDepth, 4);
  assert.equal(parsed.flags.snapshotScope, 'Counter');
  assert.equal(parsed.flags.snapshotRaw, true);
});

test('unknown short flags are rejected', () => {
  assert.throws(
    () => parseArgs(['press', '10', '20', '-x'], { strictFlags: true }),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      error.message === 'Unknown flag: -x',
  );
});

test('negative numeric positionals are accepted without -- separator', () => {
  const typed = parseArgs(['type', '-123'], { strictFlags: true });
  assert.equal(typed.command, 'type');
  assert.deepEqual(typed.positionals, ['-123']);

  const typedMulti = parseArgs(['type', '-123', '-456'], { strictFlags: true });
  assert.equal(typedMulti.command, 'type');
  assert.deepEqual(typedMulti.positionals, ['-123', '-456']);

  const pressed = parseArgs(['press', '-10', '20'], { strictFlags: true });
  assert.equal(pressed.command, 'press');
  assert.deepEqual(pressed.positionals, ['-10', '20']);
});

test('command-specific flags without command fail in strict mode', () => {
  assert.throws(
    () => parseArgs(['--depth', '3'], { strictFlags: true }),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      error.message.includes('requires a command that supports it'),
  );
});

test('command-specific flags without command warn and strip in compat mode', () => {
  const parsed = parseArgs(['--depth', '3'], { strictFlags: false });
  assert.equal(parsed.command, null);
  assert.equal(parsed.flags.snapshotDepth, undefined);
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0], /requires a command that supports/);
});

test('all commands participate in strict command-flag validation', () => {
  assert.throws(
    () => parseArgs(['open', 'Settings', '--depth', '1'], { strictFlags: true }),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      error.message.includes('not supported for command open'),
  );
});

test('invalid range errors are deterministic', () => {
  assert.throws(
    () => parseArgs(['snapshot', '--backend', 'xctest'], { strictFlags: true }),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      error.message === 'Unknown flag: --backend',
  );
  assert.throws(
    () => parseArgs(['snapshot', '--depth', '-1'], { strictFlags: true }),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      error.message === 'Invalid depth: -1',
  );
});

test('usage includes swipe and press series options', () => {
  const help = usage();
  assert.match(help, /diff <kind>/);
  assert.match(help, /swipe <x1> <y1> <x2> <y2>/);
  assert.match(help, /settings \[area\] \[options\]/);
  assert.doesNotMatch(help, /--pattern one-way\|ping-pong/);
  assert.doesNotMatch(help, /--interval-ms/);
});

test('usage renders concise commands inline with descriptions', () => {
  const help = usage();
  assert.match(help, /Commands:[\s\S]*\n  boot\s{2,}Boot target device\/simulator/);
  assert.match(
    help,
    /  metro prepare --public-base-url <url> \| --proxy-base-url <url>; metro reload\s{2,}Prepare Metro or reload apps/,
  );
  assert.match(help, /  batch --steps <json> \| --steps-file <path>\s{2,}Run multiple commands/);
  assert.match(help, /  test <path-or-glob>\.\.\.\s{2,}Run \.ad test suites/);
  assert.match(help, /  session list\s{2,}List active sessions/);
  assert.doesNotMatch(help, /  metro prepare[^\n]*--project-root/);
  assert.doesNotMatch(help, /\n  batch\s{2,}Run multiple commands/);
  assert.doesNotMatch(help, /agent-device-proxy/);
});

test('command usage describes test suite flags', () => {
  const help = usageForCommand('test');
  if (help === null) throw new Error('Expected command help text');
  assert.match(help, /Usage:\s+agent-device test <path-or-glob>\.\.\./);
  assert.match(help, /Run one or more \.ad scripts as a serial test suite/);
  assert.match(help, /--fail-fast/);
  assert.match(help, /--timeout <ms>/);
  assert.match(help, /--retries <n>/);
  assert.match(help, /--artifacts-dir <path>/);
});

test('command usage describes delayed typing flags', () => {
  const typeHelp = usageForCommand('type');
  const fillHelp = usageForCommand('fill');
  if (typeHelp === null || fillHelp === null) {
    throw new Error('Expected command help text');
  }
  assert.match(typeHelp, /--delay-ms <ms>/);
  assert.match(fillHelp, /--delay-ms <ms>/);
});

test('snapshot command usage documents diff alias', () => {
  const help = usageForCommand('snapshot');
  if (help === null) throw new Error('Expected command help text');
  assert.match(help, /agent-device snapshot \[--diff\]/);
  assert.match(help, /Capture accessibility tree or diff against the previous session baseline/);
});

test('network command usage documents include flag', () => {
  const help = usageForCommand('network');
  if (help === null) throw new Error('Expected command help text');
  assert.match(help, /--include summary\|headers\|body\|all/);
});

test('command usage shows command and global flags separately', () => {
  const help = usageForCommand('swipe');
  if (help === null) throw new Error('Expected command help text');
  assert.match(help, /Swipe coordinates with optional repeat pattern/);
  assert.match(help, /Command flags:/);
  assert.match(help, /--pattern one-way\|ping-pong/);
  assert.match(help, /Global flags:/);
  assert.match(help, /--platform ios\|macos\|android\|linux\|apple/);
});

test('back command usage documents explicit mode flags', () => {
  const help = usageForCommand('back');
  if (help === null) throw new Error('Expected command help text');
  assert.match(help, /agent-device back \[--in-app\|--system\]/);
  assert.match(help, /--in-app/);
  assert.match(help, /--system/);
});

test('open command usage documents macOS desktop surface flags', () => {
  const help = usageForCommand('open');
  if (help === null) throw new Error('Expected command help text');
  assert.match(help, /--surface app\|frontmost-app\|desktop\|menubar/);
  assert.match(help, /macOS also supports --surface/);
});

test('command usage shows record touch-overlay opt-out flag', () => {
  const help = usageForCommand('record');
  if (help === null) throw new Error('Expected command help text');
  assert.match(
    help,
    /record start \[path\] \[--fps <n>\] \[--quality <5-10>\] \[--hide-touches\] \| record stop/,
  );
  assert.match(help, /--quality <5-10>/);
  assert.match(help, /--hide-touches/);
});

test('command usage keeps detailed descriptions', () => {
  const help = usageForCommand('metro');
  if (help === null) throw new Error('Expected command help text');
  assert.match(help, /Prepare a local Metro runtime or ask Metro to reload/);
  assert.match(help, /metro reload/);
  assert.match(help, /--metro-host <host>/);
});

test('command usage shows no command flags when unsupported', () => {
  const help = usageForCommand('appstate');
  if (help === null) throw new Error('Expected command help text');
  assert.match(help, /Show foreground app\/activity/);
  assert.doesNotMatch(help, /Command flags:/);
  assert.match(help, /Global flags:/);
});

test('clipboard command usage is documented', () => {
  const help = usageForCommand('clipboard');
  if (help === null) throw new Error('Expected command help text');
  assert.match(help, /clipboard read \| clipboard write <text>/);
  assert.match(help, /Read or write device clipboard text/);
});

test('keyboard command usage is documented', () => {
  const help = usageForCommand('keyboard');
  if (help === null) throw new Error('Expected command help text');
  assert.match(help, /keyboard \[status\|get\|dismiss\]/);
  assert.match(help, /Inspect Android keyboard visibility\/type or dismiss the device keyboard/);
});

test('rotate command usage is documented', () => {
  const help = usageForCommand('rotate');
  if (help === null) throw new Error('Expected command help text');
  assert.match(help, /rotate <portrait\|portrait-upside-down\|landscape-left\|landscape-right>/);
  assert.match(help, /Rotate device orientation on iOS and Android/);
});

test('settings usage documents canonical faceid states', () => {
  const help = usageForCommand('settings');
  if (help === null) throw new Error('Expected command help text');
  assert.match(help, /light\|dark\|toggle/);
  assert.match(help, /match\|nonmatch\|enroll\|unenroll/);
  assert.match(
    help,
    /camera\|microphone\|photos\|contacts\|contacts-limited\|notifications\|calendar\|location\|location-always\|media-library\|motion\|reminders\|siri/,
  );
  assert.doesNotMatch(help, /validate\|unvalidate/);
});

test('removed trigger aliases are no longer documented as commands', () => {
  const help = usageForCommand('trigger-screenshot-notification');
  assert.equal(help, null);
});
