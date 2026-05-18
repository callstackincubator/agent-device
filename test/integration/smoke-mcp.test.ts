import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('mcp stdio entrypoint responds to initialize', async () => {
  const child = spawn(process.execPath, ['--experimental-strip-types', 'src/bin.ts', 'mcp'], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  child.stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })}\n`);

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.on('exit', (code, signal) => resolve({ code, signal }));
    },
  );

  assert.equal(exit.code, 0, stderr);
  const response = JSON.parse(stdout.trim()) as {
    result?: { serverInfo?: { name?: string }; capabilities?: Record<string, unknown> };
  };
  assert.equal(response.result?.serverInfo?.name, 'agent-device');
  assert.ok(response.result?.capabilities?.tools);
});
