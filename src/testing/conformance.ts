import assert from 'node:assert/strict';
import type { Point } from '../utils/snapshot.ts';
import type { AgentDeviceRuntime } from '../runtime.ts';
import { commands, selector, type InteractionTarget } from '../commands/index.ts';

export type ConformanceRuntimeFactory = () => AgentDeviceRuntime | Promise<AgentDeviceRuntime>;

export type CommandConformanceFixtures = {
  session: string;
  app: string;
  appEventName: string;
  appPushPayload: Record<string, unknown>;
  visibleSelector: string;
  visibleText: string;
  editableTarget: InteractionTarget;
  fillText: string;
  point: Point;
  swipeTo: Point;
};

export type CommandConformanceTarget = {
  name: string;
  createRuntime: ConformanceRuntimeFactory;
  fixtures?: Partial<CommandConformanceFixtures>;
  beforeEach?(context: CommandConformanceCaseContext): void | Promise<void>;
  afterEach?(context: CommandConformanceCaseContext): void | Promise<void>;
};

export type CommandConformanceCaseContext = {
  suite: string;
  caseName: string;
  fixtures: CommandConformanceFixtures;
};

export type CommandConformanceCase = {
  name: string;
  command: string;
  run(runtime: AgentDeviceRuntime, fixtures: CommandConformanceFixtures): Promise<void>;
};

export type CommandConformanceSuiteResult = {
  suite: string;
  passed: number;
  failed: number;
  failures: CommandConformanceFailure[];
};

export type CommandConformanceFailure = {
  suite: string;
  caseName: string;
  command: string;
  error: unknown;
};

export type CommandConformanceReport = {
  target: string;
  passed: number;
  failed: number;
  failures: CommandConformanceFailure[];
  suites: CommandConformanceSuiteResult[];
};

export type CommandConformanceSuite = {
  name: string;
  cases: readonly CommandConformanceCase[];
  run(target: CommandConformanceTarget): Promise<CommandConformanceSuiteResult>;
};

export const defaultCommandConformanceFixtures: CommandConformanceFixtures = {
  session: 'default',
  app: 'com.example.app',
  appEventName: 'example.ready',
  appPushPayload: { aps: { alert: 'hello' } },
  visibleSelector: 'label=Continue',
  visibleText: 'Continue',
  editableTarget: selector('label=Email'),
  fillText: 'hello@example.com',
  point: { x: 4, y: 8 },
  swipeTo: { x: 24, y: 28 },
};

export const captureConformanceSuite = createCommandConformanceSuite({
  name: 'capture',
  cases: [
    {
      name: 'captures screenshots through the backend primitive',
      command: 'capture.screenshot',
      run: async (runtime, fixtures) => {
        const result = await commands.capture.screenshot(runtime, {
          session: fixtures.session,
        });
        assert.equal(typeof result.path, 'string');
        assert.ok(result.path.length > 0);
      },
    },
    {
      name: 'captures snapshots with nodes',
      command: 'capture.snapshot',
      run: async (runtime, fixtures) => {
        const result = await commands.capture.snapshot(runtime, {
          session: fixtures.session,
        });
        assert.ok(Array.isArray(result.nodes));
      },
    },
  ],
});

export const selectorConformanceSuite = createCommandConformanceSuite({
  name: 'selectors',
  cases: [
    {
      name: 'finds visible text',
      command: 'selectors.find',
      run: async (runtime, fixtures) => {
        const result = await commands.selectors.find(runtime, {
          session: fixtures.session,
          query: fixtures.visibleText,
          action: 'exists',
        });
        assert.equal(result.kind, 'found');
        assert.equal(result.found, true);
      },
    },
    {
      name: 'reads text from a selector',
      command: 'selectors.getText',
      run: async (runtime, fixtures) => {
        const result = await commands.selectors.getText(runtime, {
          session: fixtures.session,
          target: selector(fixtures.visibleSelector),
        });
        assert.equal(result.kind, 'text');
        assert.equal(result.text, fixtures.visibleText);
      },
    },
    {
      name: 'checks selector visibility',
      command: 'selectors.isVisible',
      run: async (runtime, fixtures) => {
        const result = await commands.selectors.isVisible(runtime, {
          session: fixtures.session,
          target: selector(fixtures.visibleSelector),
        });
        assert.equal(result.pass, true);
      },
    },
    {
      name: 'waits for visible text',
      command: 'selectors.waitForText',
      run: async (runtime, fixtures) => {
        const result = await commands.selectors.waitForText(runtime, {
          session: fixtures.session,
          text: fixtures.visibleText,
          timeoutMs: 1,
        });
        assert.equal(result.kind, 'text');
        assert.equal(result.text, fixtures.visibleText);
      },
    },
  ],
});

export const interactionConformanceSuite = createCommandConformanceSuite({
  name: 'interactions',
  cases: [
    {
      name: 'clicks selector targets',
      command: 'interactions.click',
      run: async (runtime, fixtures) => {
        const result = await commands.interactions.click(runtime, {
          session: fixtures.session,
          target: selector(fixtures.visibleSelector),
        });
        assert.equal(result.kind, 'selector');
      },
    },
    {
      name: 'presses explicit points',
      command: 'interactions.press',
      run: async (runtime, fixtures) => {
        const result = await commands.interactions.press(runtime, {
          session: fixtures.session,
          target: { kind: 'point', ...fixtures.point },
        });
        assert.deepEqual(result.point, fixtures.point);
      },
    },
    {
      name: 'fills editable targets',
      command: 'interactions.fill',
      run: async (runtime, fixtures) => {
        const result = await commands.interactions.fill(runtime, {
          session: fixtures.session,
          target: fixtures.editableTarget,
          text: fixtures.fillText,
        });
        assert.equal(result.text, fixtures.fillText);
      },
    },
    {
      name: 'types text without a target',
      command: 'interactions.typeText',
      run: async (runtime, fixtures) => {
        const result = await commands.interactions.typeText(runtime, {
          session: fixtures.session,
          text: fixtures.fillText,
        });
        assert.equal(result.text, fixtures.fillText);
      },
    },
    {
      name: 'focuses selector targets',
      command: 'interactions.focus',
      run: async (runtime, fixtures) => {
        const result = await commands.interactions.focus(runtime, {
          session: fixtures.session,
          target: selector(fixtures.visibleSelector),
        });
        assert.equal(result.kind, 'selector');
      },
    },
    {
      name: 'long presses selector targets',
      command: 'interactions.longPress',
      run: async (runtime, fixtures) => {
        const result = await commands.interactions.longPress(runtime, {
          session: fixtures.session,
          target: selector(fixtures.visibleSelector),
          durationMs: 500,
        });
        assert.equal(result.kind, 'selector');
      },
    },
    {
      name: 'swipes explicit points',
      command: 'interactions.swipe',
      run: async (runtime, fixtures) => {
        const result = await commands.interactions.swipe(runtime, {
          session: fixtures.session,
          from: fixtures.point,
          to: fixtures.swipeTo,
        });
        assert.deepEqual(result.from, fixtures.point);
      },
    },
    {
      name: 'scrolls viewport targets',
      command: 'interactions.scroll',
      run: async (runtime, fixtures) => {
        const result = await commands.interactions.scroll(runtime, {
          session: fixtures.session,
          target: { kind: 'viewport' },
          direction: 'down',
        });
        assert.equal(result.kind, 'viewport');
      },
    },
    {
      name: 'pinches through the backend primitive',
      command: 'interactions.pinch',
      run: async (runtime) => {
        const result = await commands.interactions.pinch(runtime, {
          scale: 1.1,
        });
        assert.equal(result.kind, 'pinch');
      },
    },
  ],
});

export const systemConformanceSuite = createCommandConformanceSuite({
  name: 'system',
  cases: [
    {
      name: 'presses back',
      command: 'system.back',
      run: async (runtime, fixtures) => {
        const result = await commands.system.back(runtime, {
          session: fixtures.session,
          mode: 'in-app',
        });
        assert.equal(result.kind, 'systemBack');
      },
    },
    {
      name: 'presses home',
      command: 'system.home',
      run: async (runtime, fixtures) => {
        const result = await commands.system.home(runtime, { session: fixtures.session });
        assert.equal(result.kind, 'systemHome');
      },
    },
    {
      name: 'rotates devices',
      command: 'system.rotate',
      run: async (runtime, fixtures) => {
        const result = await commands.system.rotate(runtime, {
          session: fixtures.session,
          orientation: 'portrait',
        });
        assert.equal(result.orientation, 'portrait');
      },
    },
    {
      name: 'reads keyboard state',
      command: 'system.keyboard',
      run: async (runtime, fixtures) => {
        const result = await commands.system.keyboard(runtime, {
          session: fixtures.session,
          action: 'status',
        });
        assert.equal(result.kind, 'keyboardState');
      },
    },
    {
      name: 'reads clipboard text',
      command: 'system.clipboard',
      run: async (runtime, fixtures) => {
        const result = await commands.system.clipboard(runtime, {
          session: fixtures.session,
          action: 'read',
        });
        assert.equal(result.kind, 'clipboardText');
      },
    },
    {
      name: 'opens settings',
      command: 'system.settings',
      run: async (runtime, fixtures) => {
        const result = await commands.system.settings(runtime, {
          session: fixtures.session,
        });
        assert.equal(result.kind, 'settingsOpened');
      },
    },
    {
      name: 'reads alert state',
      command: 'system.alert',
      run: async (runtime, fixtures) => {
        const result = await commands.system.alert(runtime, {
          session: fixtures.session,
          action: 'get',
        });
        assert.equal(result.kind, 'alertStatus');
      },
    },
    {
      name: 'opens app switcher',
      command: 'system.appSwitcher',
      run: async (runtime, fixtures) => {
        const result = await commands.system.appSwitcher(runtime, {
          session: fixtures.session,
        });
        assert.equal(result.kind, 'appSwitcherOpened');
      },
    },
  ],
});

export const appsConformanceSuite = createCommandConformanceSuite({
  name: 'apps',
  cases: [
    {
      name: 'opens apps by id',
      command: 'apps.open',
      run: async (runtime, fixtures) => {
        const result = await commands.apps.open(runtime, {
          session: fixtures.session,
          app: fixtures.app,
        });
        assert.equal(result.kind, 'appOpened');
        assert.equal(result.target.app, fixtures.app);
      },
    },
    {
      name: 'closes apps by id',
      command: 'apps.close',
      run: async (runtime, fixtures) => {
        const result = await commands.apps.close(runtime, {
          session: fixtures.session,
          app: fixtures.app,
        });
        assert.equal(result.kind, 'appClosed');
        assert.equal(result.app, fixtures.app);
      },
    },
    {
      name: 'lists apps',
      command: 'apps.list',
      run: async (runtime) => {
        const result = await commands.apps.list(runtime, { filter: 'all' });
        assert.equal(result.kind, 'appsList');
        assert.ok(Array.isArray(result.apps));
      },
    },
    {
      name: 'reads app state',
      command: 'apps.state',
      run: async (runtime, fixtures) => {
        const result = await commands.apps.state(runtime, {
          session: fixtures.session,
          app: fixtures.app,
        });
        assert.equal(result.kind, 'appState');
        assert.equal(result.app, fixtures.app);
      },
    },
    {
      name: 'pushes app payloads',
      command: 'apps.push',
      run: async (runtime, fixtures) => {
        const result = await commands.apps.push(runtime, {
          session: fixtures.session,
          app: fixtures.app,
          input: { kind: 'json', payload: fixtures.appPushPayload },
        });
        assert.equal(result.kind, 'appPushed');
        assert.equal(result.inputKind, 'json');
      },
    },
    {
      name: 'triggers app events',
      command: 'apps.triggerEvent',
      run: async (runtime, fixtures) => {
        const result = await commands.apps.triggerEvent(runtime, {
          session: fixtures.session,
          name: fixtures.appEventName,
        });
        assert.equal(result.kind, 'appEventTriggered');
        assert.equal(result.name, fixtures.appEventName);
      },
    },
  ],
});

export const commandConformanceSuites: readonly CommandConformanceSuite[] = [
  captureConformanceSuite,
  selectorConformanceSuite,
  interactionConformanceSuite,
  systemConformanceSuite,
  appsConformanceSuite,
];

export async function runCommandConformance(
  target: CommandConformanceTarget,
  options: { suites?: readonly CommandConformanceSuite[] } = {},
): Promise<CommandConformanceReport> {
  const suites = options.suites ?? commandConformanceSuites;
  const results: CommandConformanceSuiteResult[] = [];
  for (const suite of suites) {
    results.push(await suite.run(target));
  }
  const failures = results.flatMap((result) => result.failures);
  return {
    target: target.name,
    passed: results.reduce((sum, result) => sum + result.passed, 0),
    failed: results.reduce((sum, result) => sum + result.failed, 0),
    failures,
    suites: results,
  };
}

export async function assertCommandConformance(
  target: CommandConformanceTarget,
  options: { suites?: readonly CommandConformanceSuite[] } = {},
): Promise<CommandConformanceReport> {
  const report = await runCommandConformance(target, options);
  if (report.failed > 0) {
    throw new AggregateError(
      report.failures.map((failure) => failure.error),
      `${target.name} failed ${report.failed} agent-device conformance case${
        report.failed === 1 ? '' : 's'
      }`,
    );
  }
  return report;
}

function createCommandConformanceSuite(params: {
  name: string;
  cases: readonly CommandConformanceCase[];
}): CommandConformanceSuite {
  return {
    name: params.name,
    cases: params.cases,
    run: async (target) => {
      const fixtures = { ...defaultCommandConformanceFixtures, ...target.fixtures };
      const failures: CommandConformanceFailure[] = [];
      let passed = 0;
      for (const testCase of params.cases) {
        const context = {
          suite: params.name,
          caseName: testCase.name,
          fixtures,
        };
        try {
          await target.beforeEach?.(context);
          const runtime = await target.createRuntime();
          await testCase.run(runtime, fixtures);
          passed += 1;
        } catch (error) {
          failures.push({
            suite: params.name,
            caseName: testCase.name,
            command: testCase.command,
            error,
          });
        } finally {
          await target.afterEach?.(context);
        }
      }
      return {
        suite: params.name,
        passed,
        failed: failures.length,
        failures,
      };
    },
  };
}
