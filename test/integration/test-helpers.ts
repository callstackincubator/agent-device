import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runCmdSync } from '../../src/utils/exec.ts';

export type CliJsonResult = {
  status: number;
  json?: any;
  stdout: string;
  stderr: string;
};

type IntegrationPlatform = 'ios' | 'android';

type StepRecord = {
  step: string;
  command: string;
  status: number;
  timestamp: string;
  errorCode?: string;
  errorMessage?: string;
};

type LastSnapshotState = {
  capturedAt: string;
  command: string;
  nodes: any[];
  rawJson: any;
};

type IntegrationTestContextOptions = {
  platform: IntegrationPlatform;
  testName: string;
};

type AssertResultOptions = {
  detail?: string;
};

export function runCliJson(args: string[]): CliJsonResult {
  const result = runCmdSync(
    process.execPath,
    ['--experimental-strip-types', 'src/bin.ts', ...args],
    { allowFailure: true },
  );
  let json: any;
  try {
    json = JSON.parse(result.stdout ?? '');
  } catch {
    json = undefined;
  }
  return {
    status: result.exitCode,
    json,
    stdout: json ? '<JSON output>' : result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export function formatResultDebug(step: string, args: string[], result: CliJsonResult): string {
  const jsonText =
    result.json === undefined ? '(unparseable)' : JSON.stringify(result.json, null, 2);
  return [
    `step: ${step}`,
    `command: agent-device ${args.join(' ')}`,
    `status: ${result.status}`,
    `stderr:`,
    result.stderr || '(empty)',
    `stdout:`,
    result.stdout || '(empty)',
    `json:`,
    jsonText,
  ].join('\n');
}

export function createIntegrationTestContext(options: IntegrationTestContextOptions) {
  const { platform, testName } = options;
  const stepHistory: StepRecord[] = [];
  let lastSnapshot: LastSnapshotState | null = null;
  let artifactDir: string | null = null;

  function runStep(step: string, args: string[], expectedStatus = 0): CliJsonResult {
    const result = runCliJson(args);
    const errorCode =
      typeof result.json?.error?.code === 'string' ? (result.json.error.code as string) : undefined;
    const errorMessage =
      typeof result.json?.error?.message === 'string' ? (result.json.error.message as string) : undefined;
    stepHistory.push({
      step,
      command: `agent-device ${args.join(' ')}`,
      status: result.status,
      timestamp: new Date().toISOString(),
      errorCode,
      errorMessage,
    });
    maybeCaptureSnapshot(args, result);
    if (result.status !== expectedStatus) {
      failWithContext(step, args, result);
    }
    return result;
  }

  function assertResult(
    condition: unknown,
    step: string,
    args: string[],
    result: CliJsonResult,
    opts?: AssertResultOptions,
  ): void {
    if (condition) {
      return;
    }
    failWithContext(step, args, result, opts?.detail ?? 'assertion failed');
  }

  function failWithContext(
    step: string,
    args: string[],
    result: CliJsonResult,
    assertionDetail?: string,
  ): never {
    const message = buildFailureDebug(step, args, result, assertionDetail);
    writeFailureArtifacts(step, args, result, message, assertionDetail);
    assert.fail(message);
  }

  function maybeCaptureSnapshot(args: string[], result: CliJsonResult): void {
    if (args[0] !== 'snapshot' || result.status !== 0) {
      return;
    }
    const nodes = Array.isArray(result.json?.data?.nodes) ? result.json.data.nodes : null;
    if (!nodes) {
      return;
    }
    lastSnapshot = {
      capturedAt: new Date().toISOString(),
      command: `agent-device ${args.join(' ')}`,
      nodes,
      rawJson: result.json,
    };
  }

  function buildFailureDebug(
    step: string,
    args: string[],
    result: CliJsonResult,
    assertionDetail?: string,
  ): string {
    const lines: string[] = [formatResultDebug(step, args, result)];
    if (assertionDetail) {
      lines.push('assertion:', assertionDetail);
    }
    lines.push('last snapshot context:', formatLastSnapshotContext(args));
    lines.push('recent step history:', formatStepHistory());
    lines.push('artifacts:', ensureArtifactDir());
    return lines.join('\n');
  }

  function formatLastSnapshotContext(args: string[]): string {
    if (!lastSnapshot) {
      return '(none)';
    }
    const snapshotLines = [
      `capturedAt: ${lastSnapshot.capturedAt}`,
      `command: ${lastSnapshot.command}`,
      `nodes: ${lastSnapshot.nodes.length}`,
    ];
    const refArg = args.find((arg) => arg.startsWith('@'));
    if (refArg) {
      const normalized = normalizeRef(refArg);
      const refNode = lastSnapshot.nodes.find((node) => normalizeRef(String(node?.ref ?? '')) === normalized);
      snapshotLines.push(
        `targetRef: ${refArg}`,
        refNode ? `targetRefInSnapshot: yes (${summarizeNode(refNode)})` : 'targetRefInSnapshot: no',
      );
    }
    const preview = lastSnapshot.nodes.slice(0, 12).map((node, i) => `${i + 1}. ${summarizeNode(node)}`);
    snapshotLines.push('nodePreview:', preview.length > 0 ? preview.join('\n') : '(empty)');
    return snapshotLines.join('\n');
  }

  function formatStepHistory(): string {
    const recent = stepHistory.slice(-8);
    if (recent.length === 0) {
      return '(empty)';
    }
    return recent
      .map((stepRecord) => {
        const error =
          stepRecord.errorCode || stepRecord.errorMessage
            ? ` error=${stepRecord.errorCode ?? ''}${stepRecord.errorMessage ? `:${stepRecord.errorMessage}` : ''}`
            : '';
        return `${stepRecord.timestamp} status=${stepRecord.status}${error} ${stepRecord.step} :: ${stepRecord.command}`;
      })
      .join('\n');
  }

  function ensureArtifactDir(): string {
    if (artifactDir) {
      return artifactDir;
    }
    const runId = new Date().toISOString().replaceAll(':', '-');
    const safeTestName = sanitizeSegment(testName);
    artifactDir = path.resolve('test/artifacts', platform, safeTestName, runId);
    mkdirSync(artifactDir, { recursive: true });
    return artifactDir;
  }

  function writeFailureArtifacts(
    step: string,
    args: string[],
    result: CliJsonResult,
    message: string,
    assertionDetail?: string,
  ): void {
    const dir = ensureArtifactDir();
    writeFileSync(path.join(dir, 'failed-step.txt'), message);
    writeFileSync(
      path.join(dir, 'failed-step.json'),
      JSON.stringify(
        {
          step,
          command: `agent-device ${args.join(' ')}`,
          assertionDetail,
          result,
          occurredAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    writeFileSync(path.join(dir, 'step-history.json'), JSON.stringify(stepHistory, null, 2));
    if (lastSnapshot) {
      writeFileSync(path.join(dir, 'last-snapshot.json'), JSON.stringify(lastSnapshot.rawJson, null, 2));
    }
  }

  return {
    runStep,
    assertResult,
  };
}

function sanitizeSegment(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-');
}

function normalizeRef(ref: string): string {
  return ref.trim().toLowerCase();
}

function summarizeNode(node: any): string {
  const ref = typeof node?.ref === 'string' ? node.ref : '(no-ref)';
  const type = typeof node?.type === 'string' ? node.type : '(no-type)';
  const label = typeof node?.label === 'string' && node.label.length > 0 ? node.label : '(no-label)';
  const rect = node?.rect ? JSON.stringify(node.rect) : '(no-bounds)';
  return `${ref} type=${type} label=${JSON.stringify(label)} rect=${rect}`;
}
