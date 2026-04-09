import { assert, type TestCase } from 'skillgym';

type SessionReport = Parameters<typeof assert.skills.has>[0];

const APP_SOURCE = /(?:^|\/)examples\/test-app\//;
const REPO_SOURCE = /(?:^|\/)src\//;
const COMMAND_DOCS = /website\/docs\/docs\/commands\.md$/;
const SUITE_FILE = /test\/skillgym\/suites\/agent-device-smoke-suite\.ts$/;

const BASE_INSTRUCTIONS = `
You are benchmarking agent-device command planning for a known fixture app.

Do not read project source files or project docs.
Do not inspect examples/test-app, src/, README.md, or website/docs.
Use only the app contract provided in this prompt and your existing agent-device knowledge.
If you need command syntax, rely on known agent-device usage patterns instead of reading repository code.
Output only the requested commands, one per line, with no explanation.
`.trim();

function buildPrompt(options: { contract: string[]; task: string }) {
  const contractLines = options.contract.map((line) => `- ${line}`).join('\n');
  return `${BASE_INSTRUCTIONS}\n\nApp contract:\n${contractLines}\n\nTask:\n${options.task}`;
}

function assertAgentDeviceEvidence(report: SessionReport) {
  const hasDetectedSkills = (report.detectedSkills?.length ?? 0) > 0;

  // Some SkillGym runners do not expose skill telemetry. Keep this as a conditional routing
  // assertion instead of failing otherwise valid command-planning runs on missing metadata.
  if (hasDetectedSkills) {
    assert.skills.has(report, 'agent-device');
  }
}

function assertNoProjectSourceReads(report: SessionReport) {
  assert.fileReads.notIncludes(report, APP_SOURCE);
  assert.fileReads.notIncludes(report, REPO_SOURCE);
  assert.fileReads.notIncludes(report, COMMAND_DOCS);
}

function commandPattern(command: string) {
  // The suite asks agents for one command per line, so command-name assertions stay line anchored.
  return new RegExp(`(?:^|\\n)(?:agent-device\\s+)?${command}(?:\\s|$)`, 'i');
}

function commandAlternativesPattern(commands: string[]) {
  const alternatives = commands.join('|');
  return new RegExp(`(?:^|\\n)(?:agent-device\\s+)?(?:${alternatives})(?:\\s|$)`, 'i');
}

function assertOutputs(report: SessionReport, matchers: Array<string | RegExp>) {
  for (const matcher of matchers) {
    assert.output.includes(report, matcher);
  }
}

function assertNoOutputs(report: SessionReport, matchers: Array<string | RegExp>) {
  for (const matcher of matchers) {
    if (typeof matcher === 'string') {
      assert.ok(
        !report.finalOutput.includes(matcher),
        `Expected final output not to include ${JSON.stringify(matcher)}. Observed final output: ${report.finalOutput}`,
      );
      continue;
    }

    assert.doesNotMatch(report.finalOutput, matcher);
  }
}

function assertExpectedOutput(report: SessionReport, matchers: Array<string | RegExp> = []) {
  if (matchers.length === 0) {
    assert.output.notEmpty(report);
    return;
  }

  assertOutputs(report, matchers);
}

const RAW_COORDINATE_TARGET =
  /(?:^|\n)(?:agent-device\s+)?(?:click|fill|press)\s+-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?/i;
const PSEUDO_ASSERTION_COMMAND = /(?:^|\n)\s*(?:assert|assertVisible|waitFor|waitForText)\b/i;

function makeCase(options: {
  id: string;
  contract: string[];
  task: string;
  outputs?: Array<string | RegExp>;
  forbiddenOutputs?: Array<string | RegExp>;
}): TestCase {
  return {
    id: options.id,
    prompt: buildPrompt({ contract: options.contract, task: options.task }),
    assert(report) {
      assertAgentDeviceEvidence(report);
      assertNoProjectSourceReads(report);
      assert.fileReads.notIncludes(report, SUITE_FILE);
      assertExpectedOutput(report, options.outputs);
      assertNoOutputs(report, options.forbiddenOutputs ?? []);
    },
  };
}

const FIXTURE_SMOKE_CASES: TestCase[] = [
  makeCase({
    id: 'open-and-snapshot',
    contract: ['App name: Agent Device Tester', 'Platform: iOS', 'Launch context: Expo Go'],
    task: 'Plan the commands to open Agent Device Tester in Expo Go on iOS, take a snapshot -i, then close.',
    outputs: [commandPattern('open'), /snapshot -i/i, commandPattern('close')],
  }),
  makeCase({
    id: 'home-dismiss-notice',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Home tab',
      'testID=dismiss-notice',
      'visible text: Release notice',
    ],
    task: 'Assume Agent Device Tester is already open on the Home tab. Plan the commands to dismiss the Release notice using the dismiss-notice testID, verify it is gone with diff snapshot -i, then close.',
    outputs: [/dismiss-notice/i, /diff snapshot -i/i, commandPattern('close')],
  }),
  makeCase({
    id: 'home-confirm-alert',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Home tab',
      'testID=home-open-modal',
      'Opening it shows a native confirmation alert',
    ],
    task: 'Assume Agent Device Tester is already open on the Home tab. Plan the commands to open the confirmation alert and dismiss it using alert wait + alert dismiss.',
    outputs: [/home-open-modal/i, commandPattern('alert wait'), commandPattern('alert dismiss')],
  }),
  makeCase({
    id: 'home-refresh-metrics',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Home tab',
      'testID=refresh-metrics',
      'visible loading text: Refreshing metrics...',
    ],
    task: 'Assume Agent Device Tester is already open on Home. Plan the commands to tap Refresh metrics, wait for "Refreshing metrics..." to appear, then verify the loading state is gone.',
    outputs: [/refresh-metrics/i, commandPattern('wait'), /Refreshing metrics/i],
  }),
  makeCase({
    id: 'home-toggle-online',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Home tab',
      'testID=toggle-online',
      'visible badge text after disabling: Offline',
    ],
    task: 'Assume Agent Device Tester is open on Home. Plan the commands to toggle Lab online off and verify the Offline badge is visible.',
    outputs: [/toggle-online/i, /Offline/i],
  }),
  makeCase({
    id: 'catalog-search-debounce',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Catalog tab',
      'testID=catalog-search',
      'Search should respect debounce timing',
    ],
    task: 'Assume Agent Device Tester is on the Catalog tab. Plan the commands to fill the search field with "tart" using --delay-ms to respect the debounce, then wait for results to update.',
    outputs: [/catalog-search/i, /--delay-ms/i, commandPattern('wait')],
  }),
  makeCase({
    id: 'catalog-filter-bakery',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Catalog tab',
      'category chip: category-bakery',
      'visible product after filtering: Berry Tart',
    ],
    task: 'Assume Agent Device Tester is on the Catalog tab. Plan the commands to select the Bakery category and verify Berry Tart is visible.',
    outputs: [/category-bakery/i, /Berry Tart/i],
  }),
  makeCase({
    id: 'catalog-favorite-toggle',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Catalog tab',
      'testID=favorite-citrus-kit',
      'label after toggling favorite: Saved',
    ],
    task: 'Assume Agent Device Tester is on the Catalog tab. Plan the commands to toggle favorite for Citrus Starter Kit and verify the label changes to Saved.',
    outputs: [/favorite-citrus-kit/i, /Saved/i],
  }),
  makeCase({
    id: 'catalog-add-to-cart',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Catalog tab',
      'testID=add-pepper-mix',
      'visible text after add: In cart: 1',
    ],
    task: 'Assume Agent Device Tester is on the Catalog tab. Plan the commands to add Pepper Mix to the cart and verify the card shows In cart: 1.',
    outputs: [/add-pepper-mix/i, /In cart: 1/i],
  }),
  makeCase({
    id: 'catalog-scroll-footer',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Catalog tab',
      'testID=catalog-footer',
      'footer visible text: Seasonal footer target',
    ],
    task: 'Assume Agent Device Tester is on the Catalog tab. Plan the commands to scroll to the Seasonal footer target card using the scroll command.',
    outputs: [commandPattern('scroll'), /(?:catalog-footer|Seasonal footer|down)/i],
    forbiddenOutputs: [/scrollintoview/i],
  }),
  makeCase({
    id: 'product-open-details',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Catalog tab',
      'testID=details-citrus-kit',
      'Product detail screen has testID=product-title',
    ],
    task: 'Assume Agent Device Tester is on the Catalog tab. Plan the commands to open Citrus Starter Kit details and verify the product title is visible.',
    outputs: [/details-citrus-kit/i, /product-title/i],
  }),
  makeCase({
    id: 'product-quantity',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: product detail',
      'testID=quantity-increase',
      'testID=quantity-decrease',
      'testID=quantity-value',
    ],
    task: 'Assume Agent Device Tester is already on a product detail screen. Plan the commands to increase quantity once, decrease it once, and get the quantity value.',
    outputs: [/quantity-increase/i, /quantity-decrease/i, /quantity-value/i],
  }),
  makeCase({
    id: 'product-note-append',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: product detail',
      'testID=product-note',
      'Use append semantics rather than replacement',
    ],
    task: 'Assume Agent Device Tester is already on a product detail screen. Plan the commands to append "Handle with care" to the product note using press + type (not fill).',
    outputs: [/product-note/i, commandPattern('press'), commandPattern('type')],
    forbiddenOutputs: [commandPattern('fill'), /(?:^|\n)(?:agent-device\s+)?type\s+@/i],
  }),
  makeCase({
    id: 'product-save-to-cart',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: product detail',
      'testID=product-save',
      'toast text after saving: Cart updated',
    ],
    task: 'Assume Agent Device Tester is already on a product detail screen. Plan the commands to press Save to cart and verify the Cart updated toast appears.',
    outputs: [/product-save/i, /Cart updated/i],
  }),
  makeCase({
    id: 'form-validation-errors',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Checkout form tab',
      'testID=submit-order',
      'validation errors card uses testID=form-errors',
    ],
    task: 'Assume Agent Device Tester is on the Checkout form tab. Plan the commands to submit with empty fields and verify the validation errors card is visible.',
    outputs: [/submit-order/i, /form-errors/i],
  }),
  makeCase({
    id: 'form-success-submit',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Checkout form tab',
      'testID=field-name',
      'testID=field-email',
      'testID=checkbox-agree',
      'success card uses testID=form-success',
    ],
    task: 'Assume Agent Device Tester is on the Checkout form tab. Plan the commands to fill name and email, check order confirmation, submit, and verify the Order summary card is visible.',
    outputs: [/field-name/i, /field-email/i, /checkbox-agree/i, /form-success/i],
  }),
  makeCase({
    id: 'form-keyboard-dismiss',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Checkout form tab',
      'testID=field-name',
      'keyboard can be dismissed after focusing the field',
    ],
    task: 'Assume Agent Device Tester is on the Checkout form tab. Plan the commands to focus the Full name field and dismiss the keyboard using keyboard dismiss.',
    outputs: [/field-name/i, /keyboard dismiss/i],
    forbiddenOutputs: [commandPattern('back')],
  }),
  makeCase({
    id: 'form-reset',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Checkout form tab',
      'testID=reset-form',
      'toast text after reset: Form cleared',
    ],
    task: 'Assume Agent Device Tester is on the Checkout form tab. Plan the commands to press Reset form and verify the Form cleared toast appears.',
    outputs: [/reset-form/i, /Form cleared/i],
  }),
  makeCase({
    id: 'settings-toggle-preferences',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Settings tab',
      'testID=toggle-notifications',
      'testID=toggle-reduced-motion',
    ],
    task: 'Assume Agent Device Tester is on the Settings tab. Plan the commands to toggle Push notifications and Reduced motion.',
    outputs: [/toggle-notifications/i, /toggle-reduced-motion/i],
  }),
  makeCase({
    id: 'settings-diagnostics-error',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Settings tab',
      'testID=load-diagnostics',
      'error panel uses testID=diagnostics-error',
    ],
    task: 'Assume Agent Device Tester is on the Settings tab. Plan the commands to load diagnostics, wait for the error state, and verify the diagnostics error panel is visible.',
    outputs: [/load-diagnostics/i, /diagnostics-error/i],
  }),
  makeCase({
    id: 'settings-diagnostics-retry',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Settings tab',
      'testID=load-diagnostics',
      'testID=retry-diagnostics',
      'ready state uses testID=diagnostics-ready',
    ],
    task: 'Assume Agent Device Tester is on the Settings tab. Plan the commands to load diagnostics, wait for the error state, retry diagnostics, then verify the Ready badge is visible.',
    outputs: [/load-diagnostics/i, /retry-diagnostics/i, /diagnostics-ready/i],
  }),
  makeCase({
    id: 'settings-reset-alert',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Settings tab',
      'testID=reset-lab',
      'native alert title: Reset Agent Device Tester?',
    ],
    task: 'Assume Agent Device Tester is on the Settings tab. Plan the commands to trigger Reset lab state, then accept the native alert using alert wait + alert accept.',
    outputs: [/reset-lab/i, commandPattern('alert wait'), commandPattern('alert accept')],
  }),
  makeCase({
    id: 'home-accessibility-audit',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Home tab',
      'Compare visible UI with the accessibility tree',
    ],
    task: 'Assume Agent Device Tester is on Home. Plan the commands to capture a screenshot and a snapshot to compare visible UI vs accessibility tree.',
    outputs: [/screenshot/i, /snapshot/i],
  }),
];

const SKILL_GUIDANCE_CASES: TestCase[] = [
  makeCase({
    id: 'inspect-visible-text-readonly',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Home tab',
      'visible status badge text: Online',
      'No interaction is needed to answer this task',
    ],
    task: 'Plan the minimal read-only command to verify whether the Online badge is visible. Do not request interactive refs or mutate the UI.',
    outputs: [/(?:^|\n)(?:agent-device\s+)?(?:snapshot|is)(?:\s|$)/i, /Online/i],
    forbiddenOutputs: [
      /snapshot -i/i,
      commandPattern('click'),
      commandPattern('fill'),
      commandPattern('press'),
    ],
  }),
  makeCase({
    id: 'target-ref-after-interactive-snapshot',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Home tab',
      'Control label: Lab online',
      'The current @ref is unknown until a fresh interactive snapshot is captured',
    ],
    task: 'Plan the commands to capture fresh interactive refs, press the Lab online control by @ref, then verify the nearby change with diff snapshot -i.',
    outputs: [
      /snapshot -i/i,
      /(?:^|\n)(?:agent-device\s+)?(?:click|press)\s+@(?:e\d+|ref)\b/i,
      /(?:diff snapshot -i|snapshot\b.*(?:-i\b.*--diff|--diff\b.*-i\b))/i,
    ],
    forbiddenOutputs: [RAW_COORDINATE_TARGET, /\btestID=/i],
  }),
  makeCase({
    id: 'target-selector-for-durable-field',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Catalog tab',
      'Durable selector: id="catalog-search"',
      'Search should respect debounce timing',
    ],
    task: 'Plan the commands to fill the catalog search field through the durable id selector with "tart" using --delay-ms, then wait for results.',
    outputs: [
      commandPattern('fill'),
      /id=(?:["']catalog-search["']|catalog-search)/i,
      /--delay-ms/i,
      commandPattern('wait'),
    ],
    forbiddenOutputs: [
      RAW_COORDINATE_TARGET,
      /(?:^|\n)(?:agent-device\s+)?type\s+@/i,
      /--selector\b/i,
      /--text\b/i,
    ],
  }),
  makeCase({
    id: 'text-replace-uses-fill',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Checkout form tab',
      'Field selector: id="field-email"',
      'Existing field value must be replaced',
    ],
    task: 'Plan the command to replace the Email field value with "qa@example.com".',
    outputs: [
      commandPattern('fill'),
      /id=(?:["']field-email["']|field-email)/i,
      /qa@example\.com/i,
    ],
    forbiddenOutputs: [commandPattern('type'), /(?:^|\n)(?:agent-device\s+)?fill\s+\d+\s+\d+/i],
  }),
  makeCase({
    id: 'offscreen-target-scroll-resnapshot',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Catalog tab',
      'Visible-first snapshot says [off-screen below] "Seasonal footer target"',
      'Off-screen refs are discovery hints, not actionable refs',
    ],
    task: 'Plan the commands to reach the Seasonal footer target from the off-screen summary, then refresh interactive refs before acting or verifying.',
    outputs: [commandPattern('scroll'), /down/i, /snapshot -i/i],
    forbiddenOutputs: [
      /scrollintoview/i,
      /(?:^|\n)(?:agent-device\s+)?(?:click|press)\s+@(?:e\d+|ref)/i,
    ],
  }),
  makeCase({
    id: 'navigation-back-in-app',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: product detail',
      'Goal: return to the Catalog tab through normal app navigation',
    ],
    task: 'Plan the command to go back to Catalog using app-owned navigation semantics.',
    outputs: [commandPattern('back')],
    forbiddenOutputs: [/back\s+--system/i],
  }),
  makeCase({
    id: 'setup-unknown-app-discover-first',
    contract: [
      'Platform: Android',
      'Target app display name is known: Agent Device Tester',
      'Package id is unknown',
      'No app session is open yet',
    ],
    task: 'Plan the bootstrap commands to discover the correct Android device and app identifier before opening the app in a named session.',
    outputs: [
      commandPattern('devices'),
      commandPattern('apps'),
      commandPattern('open'),
      /--session/i,
    ],
    forbiddenOutputs: [/com\.agent\.device\.tester/i, /com\.example/i],
  }),
  makeCase({
    id: 'install-artifact-before-open',
    contract: [
      'Platform: Android',
      'Known artifact path: ./dist/agent-device-tester.apk',
      'Known package after install: com.callstack.agentdevicetester',
      'The task requires installing the artifact',
    ],
    task: 'Plan the commands to install the APK artifact, then open the installed package in a fresh runtime state.',
    outputs: [
      commandPattern('install'),
      /\.\/dist\/agent-device-tester\.apk/i,
      commandPattern('open'),
      /--relaunch/i,
    ],
    forbiddenOutputs: [/open\s+\.\/dist\/agent-device-tester\.apk/i],
  }),
  makeCase({
    id: 'metro-reload-dev-loop',
    contract: [
      'App name: Agent Device Tester',
      'React Native dev build is already open and connected to Metro',
      'Only JavaScript changed',
    ],
    task: 'Plan the commands to reload the running app after the JS change, then verify the Home screen is visible.',
    outputs: [/(?:^|\n)(?:agent-device\s+)?metro\s+reload(?:\s|$)/i, commandPattern('snapshot')],
    forbiddenOutputs: [/open\b.*--relaunch/i],
  }),
  makeCase({
    id: 'debug-logs-short-window',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Settings tab',
      'Repro button selector: id="load-diagnostics"',
      'Need app logs only for the retry failure window',
    ],
    task: 'Plan the commands to clear and restart logs, mark the repro window, trigger diagnostics, and inspect the log path without dumping a whole stale log into context.',
    outputs: [/logs clear --restart/i, /logs mark/i, /load-diagnostics/i, /logs path/i],
    forbiddenOutputs: [/cat .*log/i, /tail -n \+1/i],
  }),
  makeCase({
    id: 'debug-network-session-dump',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Settings tab',
      'Diagnostics load triggers HTTP traffic logged by the app',
      'Need request and response headers',
    ],
    task: 'Plan the commands to reproduce the diagnostics request and inspect recent session network traffic with headers.',
    outputs: [commandPattern('network'), /dump/i, /--include headers/i],
    forbiddenOutputs: [/logs path/i, /cat .*log/i],
  }),
  makeCase({
    id: 'evidence-screenshot-overlay-refs',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Catalog tab',
      'The bug report needs visual proof and tappable-region context for icon-only controls',
    ],
    task: 'Plan the command to capture screenshot evidence with current interactive ref overlays.',
    outputs: [commandPattern('screenshot'), /--overlay-refs/i],
    forbiddenOutputs: [/snapshot --raw/i],
  }),
  makeCase({
    id: 'perf-session-metrics',
    contract: [
      'App name: Agent Device Tester',
      'Platform: iOS simulator',
      'No startup sample exists until the app is opened',
      'Need session startup, memory, and CPU data as JSON',
    ],
    task: 'Plan the commands to open the app first if needed, then collect session performance metrics as JSON.',
    outputs: [commandPattern('open'), commandAlternativesPattern(['perf', 'metrics']), /--json/i],
    forbiddenOutputs: [commandPattern('logs'), commandPattern('network')],
  }),
  makeCase({
    id: 'react-devtools-profile-search',
    contract: [
      'App name: Agent Device Tester',
      'React Native DevTools can connect to the running app',
      'Interaction to profile: type in the Catalog search field',
      'Need slow components and rerender counts',
    ],
    task: 'Plan the commands to verify React DevTools is connected, profile the Catalog search interaction, then list slow components and rerenders.',
    outputs: [
      commandPattern('react-devtools status'),
      commandPattern('react-devtools wait'),
      commandPattern('react-devtools profile start'),
      /catalog-search/i,
      commandPattern('react-devtools profile stop'),
      commandPattern('react-devtools profile slow'),
      commandPattern('react-devtools profile rerenders'),
    ],
    forbiddenOutputs: [commandPattern('snapshot'), commandPattern('perf')],
  }),
  makeCase({
    id: 'gesture-swipe-carousel',
    contract: [
      'Platform: iOS simulator',
      'Current screen: onboarding carousel',
      'Need to advance and return across pages repeatedly',
      'Gesture should use a swipe series, not scroll',
    ],
    task: 'Plan the gesture command to swipe horizontally across the carousel eight times with a short pause and ping-pong pattern.',
    outputs: [
      commandPattern('swipe'),
      /--count\s+8/i,
      /--pause-ms\s+30/i,
      /--pattern\s+ping-pong/i,
    ],
    forbiddenOutputs: [commandPattern('scroll'), RAW_COORDINATE_TARGET],
  }),
  makeCase({
    id: 'gesture-longpress-context-menu',
    contract: [
      'Platform: Android',
      'Current screen: Catalog tab',
      'Target center is x=300 y=500',
      'Need to open a native context menu with an 800ms long press',
    ],
    task: 'Plan the gesture command to long-press the target center for 800ms.',
    outputs: [commandPattern('longpress'), /300\s+500\s+800/i],
    forbiddenOutputs: [/--hold-ms/i, commandPattern('click')],
  }),
  makeCase({
    id: 'gesture-pinch-zoom',
    contract: [
      'Platform: iOS simulator',
      'Current screen: image preview',
      'Pinch is supported on Apple simulators',
      'Need to zoom out around x=200 y=400',
    ],
    task: 'Plan the gesture command to pinch zoom out at the specified center.',
    outputs: [commandPattern('pinch'), /0\.5/i, /200\s+400/i],
    forbiddenOutputs: [commandPattern('scroll'), commandPattern('swipe')],
  }),
  makeCase({
    id: 'settings-animation-stabilizer',
    contract: [
      'Platform: Android',
      'App name: Agent Device Tester',
      'Animations make this flow flaky',
      'Animations should be restored after the check',
    ],
    task: 'Plan the commands to disable platform animations before the app check, run a snapshot, then restore animations.',
    outputs: [/settings animations off/i, commandPattern('snapshot'), /settings animations on/i],
    forbiddenOutputs: [/--platform macos/i, /settings appearance/i],
  }),
  makeCase({
    id: 'trace-capture-session',
    contract: [
      'App name: Agent Device Tester',
      'An app session is already open',
      'Need low-level session diagnostics for one diagnostics-button repro',
      'Trace artifact path: ./traces/diagnostics.trace',
    ],
    task: 'Plan the commands to start trace capture, trigger diagnostics, then stop the trace into the requested artifact path.',
    outputs: [
      /trace start \.\/traces\/diagnostics\.trace/i,
      /load-diagnostics/i,
      /trace stop \.\/traces\/diagnostics\.trace/i,
    ],
    forbiddenOutputs: [commandPattern('record'), /logs clear --restart/i],
  }),
  makeCase({
    id: 'alert-visible-ui-fallback',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Home tab',
      'A visible permission sheet contains the button text "Allow"',
      'alert accept already returned no alert found',
    ],
    task: 'Plan the fallback commands to handle the visible sheet as normal tappable UI instead of looping on alert accept.',
    outputs: [
      /(?:^|\n)(?:agent-device\s+)?(?:find\b.*\bpress\b|press\b.*Allow|snapshot -i)/is,
      /Allow/i,
    ],
    forbiddenOutputs: [/alert accept.*\n.*alert accept/is, RAW_COORDINATE_TARGET],
  }),
  makeCase({
    id: 'android-keyboard-readonly-status',
    contract: [
      'Platform: Android',
      'App name: Agent Device Tester',
      'Current screen: Checkout form tab',
      'Question: is the keyboard visible and what input type is active?',
    ],
    task: 'Plan the read-only command to inspect Android keyboard visibility and input type.',
    outputs: [/(?:^|\n)(?:agent-device\s+)?keyboard\s+(?:status|get)(?:\s|$)/i],
    forbiddenOutputs: [commandPattern('fill'), commandPattern('type'), /keyboard dismiss/i],
  }),
  makeCase({
    id: 'remote-config-connect-flow',
    contract: [
      'Remote config path: ./remote-config.json',
      'App package: com.callstack.agentdevicetester',
      'The remote profile owns tenant, run, lease, and Metro hints',
    ],
    task: 'Plan a remote flow that connects through the remote config, opens the app, captures a snapshot, and disconnects cleanly.',
    outputs: [
      /connect --remote-config \.\/remote-config\.json/i,
      commandPattern('open'),
      commandPattern('snapshot'),
      commandPattern('disconnect'),
    ],
    forbiddenOutputs: [/--session\s+\w+/i, /--daemon-base-url/i, /--tenant/i, /--run-id/i],
  }),
  makeCase({
    id: 'macos-menubar-surface',
    contract: [
      'Platform: macOS',
      'App name: Agent Device Tester Menu',
      'The app lives entirely as a menu bar extra',
      'Normal app snapshots can be sparse or empty',
    ],
    task: 'Plan the commands to inspect the menu bar app surface and capture interactive refs.',
    outputs: [/--platform macos/i, /--surface menubar/i, /snapshot -i/i],
    forbiddenOutputs: [/--surface app/i, /snapshot --raw/i],
  }),
  makeCase({
    id: 'replay-maintenance-update',
    contract: [
      'Replay path: ./replays/catalog-checkout.ad',
      'Selectors drifted after a UI label change',
      'Goal: maintain the replay script in place',
    ],
    task: 'Plan the command to maintain the existing replay script after selector drift.',
    outputs: [commandPattern('replay'), /-u|--update/i, /\.\/replays\/catalog-checkout\.ad/i],
    forbiddenOutputs: [/sed\s+-i/i, /open .*\.ad/i],
  }),
  makeCase({
    id: 'batch-known-stable-flow',
    contract: [
      'App name: Agent Device Tester',
      'The full checkout flow is already known and stable',
      'Need fewer round trips while recording evidence',
    ],
    task: 'Plan the commands to start a recording, execute the known checkout steps as one batch, and stop the recording.',
    outputs: [
      /(?:^|\n)(?:agent-device\s+)?record\s+start/i,
      commandPattern('batch'),
      /(?:^|\n)(?:agent-device\s+)?record\s+stop/i,
    ],
    forbiddenOutputs: [PSEUDO_ASSERTION_COMMAND],
  }),
];

const suite: TestCase[] = [...FIXTURE_SMOKE_CASES, ...SKILL_GUIDANCE_CASES];

export default suite;
