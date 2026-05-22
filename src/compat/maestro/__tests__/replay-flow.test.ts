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
- tapOn:
    point: 20%,20%
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
- swipe:
    direction: LEFT
- scrollUntilVisible:
    element: Discover
    direction: UP
- takeScreenshot: ./screens/form.png
- hideKeyboard
- stopApp
`);

  assert.equal(parsed.metadata.env?.USER_NAME, 'Ada');
  assert.deepEqual(
    parsed.actions.map((entry) => [entry.command, entry.positionals]),
    [
      ['open', ['com.callstack.agentdevicelab']],
      ['__maestroTapOn', ['id="home-open-form"']],
      ['__maestroTapPointPercent', ['20', '20']],
      ['click', ['id="release-notice"']],
      ['click', ['label="Agent Device Tester"']],
      ['open', ['exp://localhost:8082']],
      ['__maestroTapOn', ['label="Full name" || text="Full name" || id="Full name"']],
      ['type', ['Ada Lovelace']],
      ['wait', ['label="Checkout form"', '5000']],
      ['is', ['hidden', 'label="Missing banner"']],
      ['wait', ['id="submit-order"', '7000']],
      ['scroll', ['down']],
      ['scroll', ['down', '0.4']],
      ['scroll', ['right']],
      [
        '__maestroScrollUntilVisible',
        ['label="Discover" || text="Discover" || id="Discover"', '5000', 'down'],
      ],
      ['screenshot', ['./screens/form.png']],
      ['keyboard', ['dismiss']],
      ['close', ['com.callstack.agentdevicelab']],
    ],
  );
  assert.equal(parsed.actions[3]?.flags.doubleTap, true);
  assert.equal(parsed.actions[3]?.flags.intervalMs, 150);
  assert.equal(parsed.actions[4]?.flags.holdMs, 3000);
  assert.equal(parsed.actions[1]?.flags.allowNonHittableSelectorTap, true);
  assert.equal(parsed.actions[6]?.flags?.allowNonHittableSelectorTap, undefined);
});

test('parseMaestroReplayFlow maps iOS openLink through the app id when available', () => {
  const parsed = parseMaestroReplayFlow(
    `appId: com.callstack.agentdevicelab
---
- openLink: exp://localhost:8082
`,
    { platform: 'ios' },
  );

  assert.deepEqual(
    parsed.actions.map((entry) => [entry.command, entry.positionals]),
    [['open', ['com.callstack.agentdevicelab', 'exp://localhost:8082']]],
  );
});

test('parseMaestroReplayFlow executes runScript and exposes output variables', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-maestro-runscript-'));
  const scriptPath = path.join(root, 'setup.js');
  const flowPath = path.join(root, 'flow.yml');
  fs.writeFileSync(
    scriptPath,
    `
var res = {body: '{"appviewDid":"did:plc:test"}'}
output.result = SERVER_PATH + ':' + json(res.body).appviewDid
`,
  );

  const parsed = parseMaestroReplayFlow(
    `appId: com.callstack.agentdevicelab
---
- runScript:
    file: ./setup.js
    env:
      SERVER_PATH: local
- inputText: \${output.result}
`,
    { sourcePath: flowPath },
  );

  assert.deepEqual(
    parsed.actions.map((entry) => [entry.command, entry.positionals]),
    [['type', ['local:did:plc:test']]],
  );
});

test('parseMaestroReplayFlow rejects unsupported Maestro commands', () => {
  assert.throws(
    () => parseMaestroReplayFlow('---\n- travelThroughTime: Save\n'),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /travelThroughTime/.test(error.message) &&
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

test('parseMaestroReplayFlow rejects deferred Maestro utility commands loudly', () => {
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
    () => parseMaestroReplayFlow('---\n- setPermissions:\n    camera: allow\n'),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /setPermissions/.test(error.message) &&
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
- travelThroughTime: Save
`),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /travelThroughTime/.test(error.message) &&
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
      ['__maestroTapOn', ['label="Before" || text="Before" || id="Before"']],
      ['__maestroTapOn', ['label="Nested" || text="Nested" || id="Nested"']],
      ['__maestroTapOn', ['id="child-repeat"']],
      ['__maestroTapOn', ['id="child-repeat"']],
      ['__maestroTapOn', ['label="iOS only" || text="iOS only" || id="iOS only"']],
      ['__maestroTapOn', ['label="Again" || text="Again" || id="Again"']],
      ['__maestroTapOn', ['label="Again" || text="Again" || id="Again"']],
      ['__maestroTapOn', ['label="After" || text="After" || id="After"']],
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
    [['__maestroTapOn', ['label="Shared" || text="Shared" || id="Shared"']]],
  );
});

test('parseMaestroReplayFlow keeps visible-gated runFlow commands for runtime evaluation', () => {
  const parsed = parseMaestroReplayFlow(
    `appId: com.callstack.agentdevicelab
---
- runFlow:
    when:
      visible: Continue
    commands:
      - tapOn: Continue
`,
    { platform: 'ios' },
  );

  assert.equal(parsed.actions[0]?.command, '__maestroRunFlowWhen');
  assert.deepEqual(parsed.actions[0]?.positionals, [
    'visible',
    'label="Continue" || text="Continue" || id="Continue"',
  ]);
  assert.deepEqual(parsed.actions[0]?.flags.batchSteps, [
    {
      command: '__maestroTapOn',
      positionals: ['label="Continue" || text="Continue" || id="Continue"'],
      flags: {},
    },
  ]);
});

test('parseMaestroReplayFlow accepts launchApp reset options without state-reset side effects', () => {
  const parsed = parseMaestroReplayFlow(`appId: com.callstack.agentdevicelab
---
- launchApp:
    clearState: true
    clearKeychain: true
    arguments:
      "-EXDevMenuIsOnboardingFinished": true
    launchArguments:
      "-Example": "ignored"
    stopApp: true
`);

  assert.deepEqual(
    parsed.actions.map((entry) => [entry.command, entry.positionals, entry.flags]),
    [
      [
        'open',
        ['com.callstack.agentdevicelab'],
        {
          maestroClearState: true,
          relaunch: true,
          launchArgs: ['-EXDevMenuIsOnboardingFinished', 'true', '-Example', 'ignored'],
        },
      ],
    ],
  );
});

test('parseMaestroReplayFlow rejects unsupported runtime-dependent flow control', () => {
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
      '__maestroTapOn',
      'wait',
      '__maestroTapOn',
      'type',
      '__maestroTapOn',
      'type',
      '__maestroTapOn',
      'wait',
      'wait',
      'scroll',
      '__maestroTapOn',
      'wait',
      '__maestroTapOn',
      'wait',
      '__maestroTapOn',
      'wait',
      'wait',
    ],
  );
});
