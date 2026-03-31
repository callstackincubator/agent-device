import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';

const { mockFindXctestrun, mockResolveRunnerDerivedRoot } = vi.hoisted(() => ({
  mockFindXctestrun: vi.fn(),
  mockResolveRunnerDerivedRoot: vi.fn(),
}));

vi.mock('../platforms/ios/runner-xctestrun.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platforms/ios/runner-xctestrun.ts')>();
  return {
    ...actual,
    findXctestrun: mockFindXctestrun,
    resolveRunnerDerivedRoot: mockResolveRunnerDerivedRoot,
  };
});

import { runCli } from '../cli.ts';
import type { DaemonRequest, DaemonResponse } from '../daemon-client.ts';

class ExitSignal extends Error {
  public readonly code: number;

  constructor(code: number) {
    super(`EXIT_${code}`);
    this.code = code;
  }
}

type RunResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  calls: Omit<DaemonRequest, 'token'>[];
};

async function runCliCapture(
  argv: string[],
  responder: (req: Omit<DaemonRequest, 'token'>) => Promise<DaemonResponse>,
): Promise<RunResult> {
  let stdout = '';
  let stderr = '';
  let code: number | null = null;
  const calls: Array<Omit<DaemonRequest, 'token'>> = [];

  const originalExit = process.exit;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  (process as any).exit = ((nextCode?: number) => {
    throw new ExitSignal(nextCode ?? 0);
  }) as typeof process.exit;
  (process.stdout as any).write = ((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  (process.stderr as any).write = ((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  const sendToDaemon = async (req: Omit<DaemonRequest, 'token'>): Promise<DaemonResponse> => {
    calls.push(req);
    return await responder(req);
  };

  try {
    await runCli(argv, { sendToDaemon });
  } catch (error) {
    if (error instanceof ExitSignal) code = error.code;
    else throw error;
  } finally {
    process.exit = originalExit;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }

  return { code, stdout, stderr, calls };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockResolveRunnerDerivedRoot.mockReturnValue('/tmp/agent-device-ios-runner');
});

test('cli prints build notice before human iOS runner-backed commands when no cached xctestrun exists', async () => {
  mockFindXctestrun.mockReturnValue(null);

  const result = await runCliCapture(['snapshot', '--platform', 'ios'], async (_req) => ({
    ok: true,
    data: { nodes: [] },
  }));

  assert.equal(result.code, null);
  assert.match(
    result.stdout,
    /Preparing iOS automation runner \(XCTest build\)\. This can take 10-30s on first run\.\.\./,
  );
  assert.match(result.stdout, /Snapshot: 0 nodes/);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0]?.command, 'snapshot');
});

test('cli prints restart notice when the session is already bound to iOS and cached artifacts exist', async () => {
  mockFindXctestrun.mockReturnValue('/tmp/agent-device-ios-runner/Build/Products/test.xctestrun');

  const result = await runCliCapture(['snapshot'], async (req) => {
    if (req.command === 'session_list') {
      return {
        ok: true,
        data: {
          sessions: [{ name: 'default', platform: 'ios' }],
        },
      };
    }
    return {
      ok: true,
      data: { nodes: [] },
    };
  });

  assert.equal(result.code, null);
  assert.match(
    result.stdout,
    /Restarting iOS automation runner \(XCTest\)\. This can take 10-30s while the runner reconnects\.\.\./,
  );
  assert.match(result.stdout, /Snapshot: 0 nodes/);
  assert.equal(result.calls.length, 2);
  assert.equal(result.calls[0]?.command, 'session_list');
  assert.equal(result.calls[1]?.command, 'snapshot');
});

test('cli does not print Apple runner notices in json mode', async () => {
  mockFindXctestrun.mockReturnValue(null);

  const result = await runCliCapture(['snapshot', '--platform', 'ios', '--json'], async () => ({
    ok: true,
    data: { nodes: [] },
  }));

  assert.equal(result.code, null);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.success, true);
  assert.doesNotMatch(
    result.stdout,
    /Preparing iOS automation runner|Restarting iOS automation runner/,
  );
});
