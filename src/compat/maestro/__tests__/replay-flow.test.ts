import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppError } from '../../../utils/errors.ts';
import { parseMaestroReplayFlow } from '../replay-flow.ts';

test('parseMaestroReplayFlow converts a supported Maestro command subset', () => {
  const parsed = parseMaestroReplayFlow(`appId: com.callstack.agentdevicelab
env:
  USER_NAME: Ada
---
- launchApp
- tapOn:
    id: home-open-form
- doubleTapOn:
    id: release-notice
    delay: 150
- longPressOn:
    text: Agent Device Tester
- openLink: exp://localhost:8082
- tapOn: Full name
- inputText:
    text: Ada Lovelace
    label: Full name
- assertVisible:
    text: Checkout form
- assertNotVisible:
    text: Missing banner
- extendedWaitUntil:
    visible:
      id: submit-order
    timeout: 7000
- scroll
- swipe:
    start: 50%, 75%
    end: 50%, 35%
    duration: 300
- takeScreenshot: ./screens/form.png
- hideKeyboard
- stopApp
`);

  assert.equal(parsed.metadata.env?.USER_NAME, 'Ada');
  assert.deepEqual(
    parsed.actions.map((entry) => [entry.command, entry.positionals]),
    [
      ['open', ['com.callstack.agentdevicelab']],
      ['click', ['id="home-open-form"']],
      ['click', ['id="release-notice"']],
      ['click', ['label="Agent Device Tester"']],
      ['open', ['exp://localhost:8082']],
      ['click', ['label="Full name" || text="Full name" || id="Full name"']],
      ['type', ['Ada Lovelace']],
      ['wait', ['label="Checkout form"', '5000']],
      ['is', ['hidden', 'label="Missing banner"']],
      ['wait', ['id="submit-order"', '7000']],
      ['scroll', ['down']],
      ['scroll', ['down', '0.4']],
      ['screenshot', ['./screens/form.png']],
      ['keyboard', ['dismiss']],
      ['close', ['com.callstack.agentdevicelab']],
    ],
  );
  assert.equal(parsed.actions[2]?.flags.doubleTap, true);
  assert.equal(parsed.actions[2]?.flags.intervalMs, 150);
  assert.equal(parsed.actions[3]?.flags.holdMs, 3000);
});

test('parseMaestroReplayFlow rejects unsupported Maestro commands', () => {
  assert.throws(
    () => parseMaestroReplayFlow('---\n- scrollUntilVisible: Save\n'),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /scrollUntilVisible/.test(error.message) &&
      /issues\/558/.test(error.message) &&
      /issues\/new/.test(error.message) &&
      /line 2/.test(error.message),
  );
});

test('parseMaestroReplayFlow preserves selector state and absolute swipe commands', () => {
  const parsed = parseMaestroReplayFlow(`appId: com.callstack.agentdevicelab
---
- assertVisible:
    id: shipping-pickup
    selected: true
- swipe:
    start: 100, 500
    end: 100, 200
    duration: 300
`);

  assert.deepEqual(
    parsed.actions.map((entry) => [entry.command, entry.positionals]),
    [
      ['wait', ['id="shipping-pickup" selected="true"', '5000']],
      ['swipe', ['100', '500', '100', '200', '300']],
    ],
  );
  assert.deepEqual(parsed.actionLines, [3, 6]);
});

test('parseMaestroReplayFlow maps easy Maestro device and utility commands', () => {
  const parsed = parseMaestroReplayFlow(`appId: com.callstack.agentdevicelab
env:
  VIDEO_PATH: ./recordings/checkout.mp4
---
- setAirplaneMode: true
- setAirplaneMode: false
- setLocation:
    latitude: 52.2297
    longitude: 21.0122
- setOrientation: landscapeLeft
- setPermissions:
    camera: allow
    microphone: deny
    photos: unset
    location: always
- killApp
- killApp: com.callstack.other
- pasteText: hello there
- startRecording:
    path: \${VIDEO_PATH}
- stopRecording
- assertTrue: true
`);

  assert.deepEqual(
    parsed.actions.map((entry) => [entry.command, entry.positionals]),
    [
      ['settings', ['airplane', 'on']],
      ['settings', ['airplane', 'off']],
      ['settings', ['location', 'set', '52.2297', '21.0122']],
      ['rotate', ['landscape-left']],
      ['settings', ['permission', 'grant', 'camera']],
      ['settings', ['permission', 'deny', 'microphone']],
      ['settings', ['permission', 'reset', 'photos']],
      ['settings', ['permission', 'grant', 'location-always']],
      ['close', ['com.callstack.agentdevicelab']],
      ['close', ['com.callstack.other']],
      ['type', ['hello there']],
      ['record', ['start', './recordings/checkout.mp4']],
      ['record', ['stop']],
    ],
  );
});

test('parseMaestroReplayFlow rejects unsupported easy-mapping variants loudly', () => {
  assert.throws(
    () => parseMaestroReplayFlow('---\n- assertTrue: "${READY}"\n'),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /assertTrue/.test(error.message) &&
      /issues\/558/.test(error.message) &&
      /line 2/.test(error.message),
  );

  assert.throws(
    () => parseMaestroReplayFlow('---\n- setPermissions:\n    camera: always\n'),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /setPermissions state "always"/.test(error.message) &&
      /issues\/558/.test(error.message) &&
      /line 2/.test(error.message),
  );
});

test('parseMaestroReplayFlow rejects unsupported fields instead of ignoring them', () => {
  assert.throws(
    () =>
      parseMaestroReplayFlow(`appId: com.callstack.agentdevicelab
---
- tapOn:
    id: submit-order
    retryTapIfNoChange: true
`),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /retryTapIfNoChange/.test(error.message) &&
      /issues\/558/.test(error.message) &&
      /line 3/.test(error.message),
  );
});

test('parseMaestroReplayFlow reports top-level command lines around nested lists', () => {
  assert.throws(
    () =>
      parseMaestroReplayFlow(`appId: com.callstack.agentdevicelab
---
- runFlow:
    commands:
      - tapOn: Nested
- scrollUntilVisible: Save
`),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /scrollUntilVisible/.test(error.message) &&
      /line 6/.test(error.message),
  );
});

test('parseMaestroReplayFlow flattens hooks, file runFlow, inline runFlow, env, and repeat times', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-maestro-flow-'));
  const childPath = path.join(root, 'child.yaml');
  fs.writeFileSync(
    childPath,
    `appId: com.child.app
---
- tapOn: "\${CHILD_LABEL}"
- repeat:
    times: \${COUNT}
    commands:
      - tapOn:
          id: child-repeat
`,
  );

  const parsed = parseMaestroReplayFlow(
    `appId: com.callstack.agentdevicelab
env:
  COUNT: "2"
onFlowStart:
  - tapOn: Before
onFlowComplete:
  - tapOn: After
---
- runFlow:
    file: child.yaml
    env:
      CHILD_LABEL: Nested
- runFlow:
    when:
      platform: iOS
    commands:
      - tapOn: iOS only
- repeat:
    times: 2
    commands:
      - tapOn: Again
`,
    { sourcePath: path.join(root, 'main.yaml'), platform: 'ios' },
  );

  assert.deepEqual(
    parsed.actions.map((entry) => [entry.command, entry.positionals]),
    [
      ['click', ['label="Before" || text="Before" || id="Before"']],
      ['click', ['label="Nested" || text="Nested" || id="Nested"']],
      ['click', ['id="child-repeat"']],
      ['click', ['id="child-repeat"']],
      ['click', ['label="iOS only" || text="iOS only" || id="iOS only"']],
      ['click', ['label="Again" || text="Again" || id="Again"']],
      ['click', ['label="Again" || text="Again" || id="Again"']],
      ['click', ['label="After" || text="After" || id="After"']],
    ],
  );
});

test('parseMaestroReplayFlow skips platform-gated runFlow commands for other platforms', () => {
  const parsed = parseMaestroReplayFlow(
    `appId: com.callstack.agentdevicelab
---
- runFlow:
    when:
      platform: Android
    commands:
      - tapOn: Android only
- tapOn: Shared
`,
    { platform: 'ios' },
  );

  assert.deepEqual(
    parsed.actions.map((entry) => [entry.command, entry.positionals]),
    [['click', ['label="Shared" || text="Shared" || id="Shared"']]],
  );
});

test('parseMaestroReplayFlow tolerates false launchApp reset options and rejects reset side effects', () => {
  const parsed = parseMaestroReplayFlow(`appId: com.callstack.agentdevicelab
---
- launchApp:
    clearState: false
    clearKeychain: false
    stopApp: true
`);

  assert.deepEqual(
    parsed.actions.map((entry) => [entry.command, entry.positionals, entry.flags]),
    [['open', ['com.callstack.agentdevicelab'], { relaunch: true }]],
  );

  assert.throws(
    () =>
      parseMaestroReplayFlow(`appId: com.callstack.agentdevicelab
---
- launchApp:
    clearState: true
`),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /clearState: true/.test(error.message) &&
      /line 3/.test(error.message),
  );
});

test('parseMaestroReplayFlow rejects runtime-dependent flow control for now', () => {
  assert.throws(
    () =>
      parseMaestroReplayFlow(`appId: com.callstack.agentdevicelab
---
- runFlow:
    when:
      visible: Continue
    commands:
      - tapOn: Continue
`),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /when.visible/.test(error.message) &&
      /line 3/.test(error.message),
  );

  assert.throws(
    () =>
      parseMaestroReplayFlow(`appId: com.callstack.agentdevicelab
---
- repeat:
    while:
      notVisible: Done
    times: 3
    commands:
      - tapOn: Again
`),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /repeat.while/.test(error.message) &&
      /line 3/.test(error.message),
  );
});

test('parseMaestroReplayFlow parses the test-app Maestro suite fixture', () => {
  const fixturePath = path.resolve('examples/test-app/maestro/checkout-form.yaml');
  const parsed = parseMaestroReplayFlow(fs.readFileSync(fixturePath, 'utf8'), {
    sourcePath: fixturePath,
    platform: 'ios',
  });

  assert.deepEqual(
    parsed.actions.map((entry) => entry.command),
    [
      'wait',
      'click',
      'wait',
      'click',
      'type',
      'click',
      'type',
      'click',
      'wait',
      'wait',
      'scroll',
      'click',
      'wait',
      'click',
      'wait',
      'click',
      'wait',
      'wait',
    ],
  );
});
