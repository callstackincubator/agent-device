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
Do not browse the web.
Use only this prompt plus local CLI help as private reference.
For local CLI help in this repo, use node bin/agent-device.mjs help or --help; final commands still use agent-device.
Final output: only agent-device commands, one per line. Any prose or Markdown fails.
`.trim();

function buildPrompt(options: { contract: string[]; task: string }) {
  const contractLines = options.contract.map((line) => `- ${line}`).join('\n');
  return `${BASE_INSTRUCTIONS}\n\nApp contract:\n${contractLines}\n\nTask:\n${options.task}`;
}

function assertAgentDeviceEvidence(report: SessionReport) {
  const detectedSkills = report.detectedSkills ?? [];
  const hasDetectedSkills = detectedSkills.length > 0;
  const hasBundledDeviceSkill = detectedSkills.some((skill) =>
    ['agent-device', 'react-devtools', 'dogfood'].includes(skill.skill),
  );

  // Some SkillGym runners do not expose skill telemetry. Keep this as a conditional routing
  // assertion instead of failing otherwise valid command-planning runs on missing metadata.
  if (hasDetectedSkills) {
    assert.ok(
      hasBundledDeviceSkill,
      `Expected detectedSkills to include an agent-device bundled skill. Observed detectedSkills: ${detectedSkills
        .map((skill) => `${skill.skill} (${skill.confidence})`)
        .join(', ')}`,
    );
  }
}

function assertNoProjectSourceReads(report: SessionReport) {
  assert.fileReads.notIncludes(report, APP_SOURCE);
  assert.fileReads.notIncludes(report, REPO_SOURCE);
  assert.fileReads.notIncludes(report, COMMAND_DOCS);
}

function commandPattern(command: string) {
  // The suite asks agents for one command per line, so command-name assertions stay line anchored.
  return new RegExp(
    `(?:^|\\n)(?:agent-device(?:\\s+--[^\\s]+(?:\\s+(?!-)[^\\s]+)?)*\\s+)?${command}(?:\\s|$)`,
    'i',
  );
}

function commandAlternativesPattern(commands: string[]) {
  const alternatives = commands.join('|');
  return new RegExp(
    `(?:^|\\n)(?:agent-device(?:\\s+--[^\\s]+(?:\\s+(?!-)[^\\s]+)?)*\\s+)?(?:${alternatives})(?:\\s|$)`,
    'i',
  );
}

function assertOutputs(report: SessionReport, matchers: Array<string | RegExp>) {
  const output = normalizedFinalOutput(report);
  for (const matcher of matchers) {
    if (typeof matcher === 'string') {
      assert.ok(
        output.includes(matcher),
        `Expected final output to include ${JSON.stringify(matcher)}. Observed final output: ${report.finalOutput}`,
      );
      continue;
    }

    assert.match(output, matcher);
  }
}

function assertNoOutputs(report: SessionReport, matchers: Array<string | RegExp>) {
  const output = normalizedFinalOutput(report);
  for (const matcher of matchers) {
    if (typeof matcher === 'string') {
      assert.ok(
        !output.includes(matcher),
        `Expected final output not to include ${JSON.stringify(matcher)}. Observed final output: ${report.finalOutput}`,
      );
      continue;
    }

    assert.doesNotMatch(output, matcher);
  }
}

function normalizedFinalOutput(report: SessionReport): string {
  return report.finalOutput
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    .replace(/`([^`\n]+)`/g, '$1')
    .trim();
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
const COMPACT_RECT_SNAPSHOT = /snapshot\b(?=[^\n]*(?:-c\b|--compact\b))(?=[^\n]*(?:--json|--raw))/i;

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
    outputs: [
      /dismiss-notice/i,
      /(?:diff snapshot -i|snapshot\b.*(?:-i\b.*--diff|--diff\b.*-i\b))/i,
      commandPattern('close'),
    ],
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
    outputs: [/(?:category-bakery|Bakery)/i, /Berry Tart/i],
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
    outputs: [/(?:^|\n)(?:agent-device\s+)?(?:snapshot|is|find)(?:\s|$)/i, /Online/i],
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
      'The target control has no stable selector in the task context',
      'Fresh interactive snapshot will expose the target as @e12',
    ],
    task: 'Plan the commands to capture fresh interactive refs, press the target control with its @e12 ref, then verify the nearby change with diff snapshot -i.',
    outputs: [
      /snapshot -i/i,
      /(?:^|\n)(?:agent-device\s+)?(?:click|press)\s+@e12\b/i,
      /(?:diff snapshot -i|snapshot\b.*(?:-i\b.*--diff|--diff\b.*-i\b))/i,
    ],
    forbiddenOutputs: [RAW_COORDINATE_TARGET, /\btestID=/i],
  }),
  makeCase({
    id: 'ios-disabled-row-raw-rect-fallback',
    contract: [
      'Platform: iOS simulator',
      'Current screen: Orders list',
      'Fresh interactive snapshot shows @e12 [disabled] hittable:false label "Order #1042"',
      'press @e12 already returned success, but diff snapshot showed no navigation',
      'Compact raw JSON rect center for @e12 is x=196 y=318',
    ],
    task: 'Plan the fallback commands to inspect raw compact snapshot rects, press the row center, then verify the nearby change.',
    outputs: [
      COMPACT_RECT_SNAPSHOT,
      /(?:^|\n)(?:agent-device\s+)?(?:press|click)\s+196\s+318\b/i,
      /(?:diff snapshot|snapshot\b.*--diff)/i,
    ],
    forbiddenOutputs: [/(?:^|\n)(?:agent-device\s+)?(?:press|click)\s+@e12\b/i, /scrollintoview/i],
  }),
  makeCase({
    id: 'truncated-text-input-scope-ref',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Checkout form tab',
      'Fresh interactive snapshot already shows @e7 [textinput] "Delivery instructions" [preview:"Leave at side gate..." truncated]',
      'Need the full text value of that truncated input before deciding whether to edit it',
    ],
    task: 'Plan the command to expand the truncated Delivery instructions text input using the current @e7 ref.',
    outputs: [
      commandPattern('snapshot'),
      /(?:^|\n)(?:agent-device\s+)?snapshot\b.*(?:-s|--scope)\s+@e7\b/i,
    ],
    forbiddenOutputs: [
      /snapshot --raw/i,
      commandPattern('get'),
      commandPattern('fill'),
      commandPattern('type'),
      commandPattern('press'),
      RAW_COORDINATE_TARGET,
    ],
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
    id: 'ios-allow-paste-prefill-only',
    contract: [
      'App name: Agent Device Tester',
      'Platform: iOS simulator',
      'App reads UIPasteboard.general when opened',
      'iOS Allow Paste system prompt is suppressed under XCUITest automation',
      'Need to test app behavior when pasteboard contains: some text',
    ],
    task: 'Plan commands to prefill the simulator pasteboard and open the app for paste-driven behavior. Do not try to automate the Allow Paste system dialog.',
    outputs: [commandPattern('clipboard'), /write/i, /some text/i, commandPattern('open')],
    forbiddenOutputs: [
      /Allow Paste/i,
      /alert (?:wait|accept|dismiss)/i,
      /\bxcrun\b/i,
      /\bsimctl\b/i,
    ],
  }),
  makeCase({
    id: 'android-non-ascii-text-stays-in-fill',
    contract: [
      'Platform: Android',
      'Current screen: Checkout form tab',
      'Field selector: id="field-name"',
      'Desired value: Café ☕ 🎉',
      'Some Android system images fail with direct platform-shell text injection',
    ],
    task: 'Plan only the robust agent-device command to fill the field with the provided non-ASCII value.',
    outputs: [commandPattern('fill'), /id=(?:["']field-name["']|field-name)/i, /Café ☕ 🎉/i],
    forbiddenOutputs: [/\badb\b/i, /shell input text/i, /\bime\b/i, /ADBKeyBoard/i],
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
    id: 'ios-composite-horizontal-tabs-coordinate-fallback',
    contract: [
      'Platform: iOS simulator',
      'Current screen: Catalog filters',
      'Horizontal filter tabs are collapsed into one [seekbar] in snapshot -i',
      'The individual Bakery tab has no @ref or selector on iOS',
      'Compact raw JSON plus visual inspection gives Bakery center x=84 y=220',
    ],
    task: 'Plan commands to handle the missing child refs by inspecting raw compact rects, tapping the Bakery center, and verifying the selected filter changed.',
    outputs: [
      COMPACT_RECT_SNAPSHOT,
      /(?:^|\n)(?:agent-device\s+)?(?:press|click)\s+84\s+220\b/i,
      /(?:diff snapshot -i|snapshot\b.*(?:-i\b.*--diff|--diff\b.*-i\b)|snapshot -i|Berry Tart|Bakery)/i,
    ],
    forbiddenOutputs: [
      /(?:^|\n)(?:agent-device\s+)?(?:press|click)\s+@(?:e\d+|ref)\b/i,
      /scrollintoview/i,
    ],
  }),
  makeCase({
    id: 'list-text-presence-prefers-wait-text',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Catalog tab',
      'List content loads asynchronously',
      'Expected list item text: Trip ideas',
      'No interaction is needed; this is a presence check for visible text in a list',
    ],
    task: 'Plan the robust read-only command to wait for the Trip ideas list text to appear.',
    outputs: [commandPattern('wait'), /Trip ideas/i],
    forbiddenOutputs: [commandPattern('is visible'), /snapshot -i/i, commandPattern('press')],
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
    id: 'navigation-back-ambiguous-use-visible-nav',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: nested product detail',
      'Previous back command navigated to an unexpected screen',
      'Visible app nav button selector: id="nav-back"',
      'Goal: return one level inside the app, not trigger system back',
    ],
    task: 'Plan the next navigation command using the visible app-owned control instead of retrying back.',
    outputs: [/nav-back/i, commandAlternativesPattern(['press', 'click'])],
    forbiddenOutputs: [commandPattern('back'), /back\s+--system/i],
  }),
  makeCase({
    id: 'setup-unknown-app-discover-first',
    contract: [
      'Platform: Android',
      'Target app display name is known: Agent Device Tester',
      'Package id is unknown',
      'No app session is open yet',
      'Session name: discovery',
    ],
    task: 'Plan the bootstrap commands to discover the correct Android device and app identifier, then open the discovered app in the named session.',
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
    id: 'install-from-github-artifact-before-open',
    contract: [
      'Platform: Android',
      'Install source: GitHub Actions artifact callstackincubator/agent-device:agent-device-tester-apk',
      'Known package after install: com.callstack.agentdevicetester',
      'Remote daemon can resolve the artifact server-side',
    ],
    task: 'Plan commands to install from the GitHub Actions artifact, then open the installed package in fresh runtime state.',
    outputs: [
      commandPattern('install-from-source'),
      /--github-actions-artifact\s+callstackincubator\/agent-device:agent-device-tester-apk/i,
      commandPattern('open'),
      /com\.callstack\.agentdevicetester/i,
      /--relaunch/i,
    ],
    forbiddenOutputs: [
      /curl\b/i,
      /gh\s+(?:run|artifact|download)/i,
      /open\s+.*agent-device-tester-apk/i,
    ],
  }),
  makeCase({
    id: 'hidden-info-do-not-force-ui',
    contract: [
      'App name: Agent Device Tester',
      'Current screen: Home tab',
      'Question: what is the hidden promo code?',
      'The current screen does not expose any promo code text or selector',
      'No interaction was requested',
    ],
    task: 'Plan the minimal read-only command to inspect exposed UI without typing, navigating, or mutating the app to reveal hidden information.',
    outputs: [commandPattern('snapshot')],
    forbiddenOutputs: [
      /snapshot -i/i,
      commandPattern('press'),
      commandPattern('click'),
      commandPattern('fill'),
      commandPattern('type'),
      commandPattern('open'),
    ],
  }),
  makeCase({
    id: 'metro-reload-dev-loop',
    contract: [
      'App name: Agent Device Tester',
      'React Native dev build is already open and connected to Metro',
      'Only JavaScript changed',
    ],
    task: 'Plan the commands to reload the running app after the JS change, then verify the Home screen is visible.',
    outputs: [
      /(?:^|\n)(?:agent-device\s+)?metro\s+reload(?:\s|$)/i,
      /(?:^|\n)(?:agent-device\s+)?(?:snapshot\b|find\b[^\n]*Home|is\b[^\n]*Home|wait\b[^\n]*Home)/i,
    ],
    forbiddenOutputs: [/open\b.*--relaunch/i, /(?:^|\n)(?:agent-device\s+)?screenshot\b/i],
  }),
  makeCase({
    id: 'rn-warning-overlay-dismiss-before-tap',
    contract: [
      'App name: Agent Device Tester',
      'Current screen after opening will trigger console.warn',
      'Fresh interactive snapshot should show the minimized React Native warning overlay',
      'Overlay close control label: Dismiss',
      'The warning overlay can obscure UI and intercept taps',
      'Target selector after dismissing overlay: id="submit-order"',
    ],
    task: 'Plan commands to identify the warning overlay in snapshot -i, dismiss it, verify the overlay is gone with diff snapshot -i or a fresh snapshot -i, then press the submit target.',
    outputs: [
      /snapshot -i[\s\S]*(?:press|click)\b[^\n]*(?:Dismiss|Close|warning)[\s\S]*(?:diff snapshot -i|snapshot\b.*-i)/i,
      /submit-order/i,
    ],
    forbiddenOutputs: [
      commandPattern('screenshot'),
      RAW_COORDINATE_TARGET,
      /(?:^|\n)(?:agent-device\s+)?(?:press|click)\b[^\n]*submit-order[\s\S]*(?:Dismiss|Close)/i,
      /alert accept/i,
    ],
  }),
  makeCase({
    id: 'expo-go-ios-project-url',
    contract: [
      'Platform: iOS simulator',
      'Launch context: Expo Go',
      'Project URL: exp://127.0.0.1:8081',
      'The native bundle id for the project is not installed separately',
    ],
    task: 'Plan the command to launch the Expo project in Expo Go without inventing a native bundle id.',
    outputs: [commandPattern('open'), /exp:\/\/127\.0\.0\.1:8081/i, /--platform ios/i],
    forbiddenOutputs: [
      /open\s+Agent Device Tester/i,
      /host\.exp\.Exponent/i,
      /com\.(?:callstack|example|agent)/i,
    ],
  }),
  makeCase({
    id: 'expo-go-ios-after-app-id-miss',
    contract: [
      'Platform: iOS simulator',
      'Target app display name: Agent Device Tester',
      'Previous apps lookup did not list Agent Device Tester',
      'Previous apps lookup did list Expo Go',
      'Project URL: exp://127.0.0.1:8081',
    ],
    task: 'Plan the next command to launch the project after the app-id lookup miss without inventing a native bundle id.',
    outputs: [commandPattern('open'), /exp:\/\/127\.0\.0\.1:8081/i],
    forbiddenOutputs: [
      /open\s+Agent Device Tester/i,
      /com\.(?:callstack|example|agent)/i,
      /host\.exp\.Exponent/i,
    ],
  }),
  makeCase({
    id: 'expo-go-android-url-only',
    contract: [
      'Platform: Android',
      'Launch context: Expo Go',
      'Project URL: exp://10.0.2.2:8081',
      'Android does not support open <app> <url>; use a URL target for deep links',
    ],
    task: 'Plan the command to launch the Expo project on Android using the project URL.',
    outputs: [commandPattern('open'), /exp:\/\/10\.0\.2\.2:8081/i, /--platform android/i],
    forbiddenOutputs: [
      /open\s+(?:"Expo Go"|Expo\s+Go)\s+exp:\/\//i,
      /--activity/i,
      /host\.exp\.exponent/i,
    ],
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
      'Repro button selector: id="load-diagnostics"',
      'Need request and response headers',
    ],
    task: 'Plan the commands to reproduce the diagnostics request and inspect recent session network traffic with headers.',
    outputs: [
      /load-diagnostics/i,
      commandPattern('network'),
      /dump/i,
      /(?:--include\s+headers|\bheaders\b)/i,
    ],
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
      'Search field selector: id="catalog-search"',
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
    id: 'react-devtools-exact-component-inspect',
    contract: [
      'App name: Agent Device Tester',
      'React Native DevTools is connected',
      'Need current props, state, and hooks for component SearchScreen',
      'Fuzzy component search returns noisy matches unless exact matching is used',
    ],
    task: 'Plan bounded React DevTools commands to find the exact SearchScreen component and inspect it.',
    outputs: [
      commandPattern('react-devtools find'),
      /SearchScreen/i,
      /--exact/i,
      commandPattern('react-devtools get component'),
    ],
    forbiddenOutputs: [commandPattern('snapshot'), commandPattern('perf')],
  }),
  makeCase({
    id: 'react-devtools-render-cause-report',
    contract: [
      'App name: Agent Device Tester',
      'React Native profile has already been stopped',
      'Rerender suspect from profile output: @c12',
      'Need render causes and changed props/state/hooks for that component',
    ],
    task: 'Plan the React DevTools command to inspect render causes for @c12.',
    outputs: [commandPattern('react-devtools profile report'), /@c12/i],
    forbiddenOutputs: [
      commandPattern('snapshot'),
      commandPattern('perf'),
      commandPattern('react-devtools profile slow'),
      commandPattern('react-devtools profile rerenders'),
    ],
  }),
  makeCase({
    id: 'gesture-swipe-carousel',
    contract: [
      'Platform: iOS simulator',
      'Current screen: onboarding carousel',
      'Need to advance and return across pages repeatedly',
      'Gesture should use a swipe series, not scroll',
    ],
    task: 'Plan the gesture command to swipe horizontally across the carousel eight times with a 30ms pause and ping-pong pattern.',
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
    forbiddenOutputs: [/--duration-ms/i, /--hold-ms/i, commandPattern('click')],
  }),
  makeCase({
    id: 'gesture-pinch-zoom',
    contract: [
      'Platform: iOS simulator',
      'Current screen: image preview',
      'Pinch is supported on Apple simulators',
      'Need to zoom out around x=200 y=400',
      'Zoom-out scale: 0.5',
    ],
    task: 'Plan the gesture command to pinch zoom out at the specified center.',
    outputs: [commandPattern('pinch'), /0\.5/i, /200\s+400/i],
    forbiddenOutputs: [
      /(?:^|\s)--scale(?!\w)/i,
      /(?:^|\s)--x(?!\w)/i,
      /(?:^|\s)--y(?!\w)/i,
      commandPattern('scroll'),
      commandPattern('swipe'),
    ],
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
    forbiddenOutputs: [
      /--platform macos/i,
      /settings appearance/i,
      /animations disable/i,
      /animations restore/i,
    ],
  }),
  makeCase({
    id: 'trace-capture-session',
    contract: [
      'App name: Agent Device Tester',
      'An app session is already open',
      'Repro button selector: id="load-diagnostics"',
      'Need low-level session diagnostics for one diagnostics-button repro',
      'Trace artifact path: ./traces/diagnostics.trace',
    ],
    task: 'Plan the commands to start trace capture, trigger diagnostics, then stop the trace into the requested artifact path.',
    outputs: [
      /trace start \.\/traces\/diagnostics\.trace/i,
      /load-diagnostics/i,
      /trace stop \.\/traces\/diagnostics\.trace/i,
    ],
    forbiddenOutputs: [
      commandPattern('record'),
      /logs clear --restart/i,
      /trace (?:start|stop) --path/i,
    ],
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
      /(?:^|\n)(?:agent-device\s+)?(?:find\b.*\bpress\b|(?:press|click)\b.*Allow|snapshot -i)/is,
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
    forbiddenOutputs: [
      /--daemon-base-url/i,
      /--tenant/i,
      /--run-id/i,
      commandPattern('screenshot'),
    ],
  }),
  makeCase({
    id: 'remote-config-script-flow',
    contract: [
      'Remote config path: ./remote-config.json',
      'App package: com.callstack.agentdevicetester',
      'This is a self-contained script where every command must be explicit',
      'The remote profile owns tenant, run, lease, and Metro hints',
    ],
    task: 'Plan a self-contained remote script that opens the app, captures a snapshot, and disconnects using the remote config on every command.',
    outputs: [
      /(?:--remote-config\s+\.\/remote-config\.json[^\n]*open|open\b[^\n]*--remote-config\s+\.\/remote-config\.json)/i,
      /(?:--remote-config\s+\.\/remote-config\.json[^\n]*snapshot|snapshot\b[^\n]*--remote-config\s+\.\/remote-config\.json)/i,
      /(?:--remote-config\s+\.\/remote-config\.json[^\n]*disconnect|disconnect\b[^\n]*--remote-config\s+\.\/remote-config\.json)/i,
    ],
    forbiddenOutputs: [/--daemon-base-url/i, /--tenant/i, /--run-id/i],
  }),
  makeCase({
    id: 'macos-menubar-surface',
    contract: [
      'Platform: macOS',
      'App name: Agent Device Tester Menu',
      'The app lives entirely as a menu bar extra',
      'Normal app snapshots can be sparse or empty',
    ],
    task: 'Plan the commands to inspect the menu bar app surface and capture interactive refs with snapshot -i.',
    outputs: [/--platform macos/i, /--surface menubar/i, /snapshot\b.*(?:-i\b|\s-i\b)/i],
    forbiddenOutputs: [/--surface app/i, /snapshot --raw/i],
  }),
  makeCase({
    id: 'macos-context-menu-secondary-click',
    contract: [
      'Platform: macOS',
      'Current surface: app',
      'Target row current ref: @e66',
      'Need to open its native context menu and inspect menu item refs',
    ],
    task: 'Plan commands to open the context menu for @e66 and then refresh interactive refs for the menu items.',
    outputs: [
      commandPattern('click'),
      /@e66/i,
      /--button\s+secondary/i,
      /--platform\s+macos/i,
      /snapshot\b.*-i/i,
    ],
    forbiddenOutputs: [commandPattern('longpress'), RAW_COORDINATE_TARGET, /--surface menubar/i],
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
      'Known batch steps file: ./checkout-steps.json',
      'Need fewer round trips while recording evidence',
    ],
    task: 'Plan the commands to start a recording, execute the known checkout steps from the provided steps file as one batch, and stop the recording.',
    outputs: [
      /(?:^|\n)(?:agent-device\s+)?record\s+start/i,
      commandPattern('batch'),
      /(?:^|\n)(?:agent-device\s+)?record\s+stop/i,
    ],
    forbiddenOutputs: [PSEUDO_ASSERTION_COMMAND, /workflow batch/i, commandPattern('trace')],
  }),
  makeCase({
    id: 'batch-inline-step-schema-positionals',
    contract: [
      'Need one inline batch command',
      'Step 1: open settings',
      'Step 2: wait 100 ms',
      'Batch step schema supports command, positionals, flags, and runtime',
      'The args field is invalid and must not be used',
    ],
    task: 'Plan the batch command with inline JSON steps using the supported step field for positional arguments.',
    outputs: [commandPattern('batch'), /--steps/i, /"positionals"\s*:/i, /"open"/i, /"wait"/i],
    forbiddenOutputs: [/"args"\s*:/i, /workflow batch/i],
  }),
];

const suite: TestCase[] = [...FIXTURE_SMOKE_CASES, ...SKILL_GUIDANCE_CASES];

export default suite;
