import { spawn } from 'node:child_process';
import fs from 'node:fs';
import type { ExecResult } from '../utils/exec.ts';

export async function waitForChildExit(
  wait: Promise<ExecResult>,
  timeoutMs = 2_000,
): Promise<void> {
  await Promise.race([
    wait.then(() => undefined).catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function redactChunk(chunk: string, patterns: RegExp[]): string {
  if (patterns.length === 0) return chunk;
  let output = chunk;
  for (const pattern of patterns) {
    output = output.replace(pattern, '[REDACTED]');
  }
  return output;
}

export function createLineWriter(
  stream: fs.WriteStream,
  options: { redactionPatterns: RegExp[]; includeTokens?: string[] },
): { onChunk: (chunk: string) => void; flush: () => void } {
  const includeTokens = options.includeTokens?.filter((token) => token.length > 0) ?? [];
  let pending = '';

  const writeLine = (line: string): void => {
    if (includeTokens.length > 0) {
      const shouldInclude = includeTokens.some((token) => line.includes(token));
      if (!shouldInclude) return;
    }
    stream.write(redactChunk(line, options.redactionPatterns));
  };

  return {
    onChunk: (chunk: string) => {
      const combined = `${pending}${chunk}`;
      const lines = combined.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        writeLine(`${line}\n`);
      }
    },
    flush: () => {
      if (!pending) return;
      writeLine(pending);
      pending = '';
    },
  };
}

export function attachChildToStream(
  child: ReturnType<typeof spawn>,
  stream: fs.WriteStream,
  options: {
    endStreamOnClose: boolean;
    writer: { onChunk: (chunk: string) => void; flush: () => void };
  },
): Promise<ExecResult> {
  const stdout = child.stdout;
  const stderr = child.stderr;
  if (!stdout || !stderr) {
    return Promise.resolve({ stdout: '', stderr: 'missing stdio pipes', exitCode: 1 });
  }
  stdout.setEncoding('utf8');
  stderr.setEncoding('utf8');
  stdout.on('data', options.writer.onChunk);
  stderr.on('data', options.writer.onChunk);
  stream.on('error', () => {
    if (!child.killed) child.kill('SIGKILL');
  });
  child.on('error', () => stream.destroy());
  return new Promise<ExecResult>((resolve) => {
    child.on('close', (code) => {
      options.writer.flush();
      if (options.endStreamOnClose) stream.end();
      resolve({ stdout: '', stderr: '', exitCode: code ?? 1 });
    });
  });
}
