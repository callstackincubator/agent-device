import assert from 'node:assert/strict';
import type { Point } from '../utils/snapshot.ts';
import type { AgentDeviceRuntime } from '../runtime.ts';
import { commands, selector, type InteractionTarget } from '../commands/index.ts';

export type ConformanceRuntimeFactory = () => AgentDeviceRuntime | Promise<AgentDeviceRuntime>;

export type CommandConformanceFixtures = {
  session: string;
  visibleSelector: string;
  visibleText: string;
  editableTarget: InteractionTarget;
  fillText: string;
  point: Point;
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
  visibleSelector: 'label=Continue',
  visibleText: 'Continue',
  editableTarget: selector('label=Email'),
  fillText: 'hello@example.com',
  point: { x: 4, y: 8 },
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
  ],
});

export const commandConformanceSuites: readonly CommandConformanceSuite[] = [
  captureConformanceSuite,
  selectorConformanceSuite,
  interactionConformanceSuite,
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
