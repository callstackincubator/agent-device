import { spawn, spawnSync } from 'node:child_process';
import { AppError } from './errors.ts';

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  stdoutBuffer?: Buffer;
};

export type ExecOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  allowFailure?: boolean;
  binaryStdout?: boolean;
};

export type ExecStreamOptions = ExecOptions & {
  onStdoutChunk?: (chunk: string) => void;
  onStderrChunk?: (chunk: string) => void;
};

export async function runCmd(
  cmd: string,
  args: string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stdoutBuffer: Buffer | undefined = options.binaryStdout ? Buffer.alloc(0) : undefined;
    let stderr = '';

    if (!options.binaryStdout) child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
      if (options.binaryStdout) {
        stdoutBuffer = Buffer.concat([
          stdoutBuffer ?? Buffer.alloc(0),
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
        ]);
      } else {
        stdout += chunk;
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        reject(new AppError('TOOL_MISSING', `${cmd} not found in PATH`, { cmd }, err));
        return;
      }
      reject(new AppError('COMMAND_FAILED', `Failed to run ${cmd}`, { cmd, args }, err));
    });

    child.on('close', (code) => {
      const exitCode = code ?? 1;
      if (exitCode !== 0 && !options.allowFailure) {
        reject(
          new AppError('COMMAND_FAILED', `${cmd} exited with code ${exitCode}`, {
            cmd,
            args,
            stdout,
            stderr,
            exitCode,
          }),
        );
        return;
      }
      resolve({ stdout, stderr, exitCode, stdoutBuffer });
    });
  });
}

export async function whichCmd(cmd: string): Promise<boolean> {
  try {
    const { shell, args } = resolveWhichArgs(cmd);
    const result = await runCmd(shell, args, { allowFailure: true });
    return result.exitCode === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export function runCmdSync(cmd: string, args: string[], options: ExecOptions = {}): ExecResult {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: options.binaryStdout ? undefined : 'utf8',
  });

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new AppError('TOOL_MISSING', `${cmd} not found in PATH`, { cmd }, result.error);
    }
    throw new AppError('COMMAND_FAILED', `Failed to run ${cmd}`, { cmd, args }, result.error);
  }

  const stdoutBuffer = options.binaryStdout
    ? Buffer.isBuffer(result.stdout)
      ? result.stdout
      : Buffer.from(result.stdout ?? '')
    : undefined;
  const stdout = options.binaryStdout
    ? ''
    : typeof result.stdout === 'string'
      ? result.stdout
      : (result.stdout ?? '').toString();
  const stderr =
    typeof result.stderr === 'string' ? result.stderr : (result.stderr ?? '').toString();
  const exitCode = result.status ?? 1;

  if (exitCode !== 0 && !options.allowFailure) {
    throw new AppError('COMMAND_FAILED', `${cmd} exited with code ${exitCode}`, {
      cmd,
      args,
      stdout,
      stderr,
      exitCode,
    });
  }

  return { stdout, stderr, exitCode, stdoutBuffer };
}

export function runCmdDetached(cmd: string, args: string[], options: ExecOptions = {}): void {
  const child = spawn(cmd, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
}

export async function runCmdStreaming(
  cmd: string,
  args: string[],
  options: ExecStreamOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stdoutBuffer: Buffer | undefined = options.binaryStdout ? Buffer.alloc(0) : undefined;

    if (!options.binaryStdout) child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
      if (options.binaryStdout) {
        stdoutBuffer = Buffer.concat([
          stdoutBuffer ?? Buffer.alloc(0),
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
        ]);
        return;
      }
      const text = String(chunk);
      stdout += text;
      options.onStdoutChunk?.(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      options.onStderrChunk?.(text);
    });

    child.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        reject(new AppError('TOOL_MISSING', `${cmd} not found in PATH`, { cmd }, err));
        return;
      }
      reject(new AppError('COMMAND_FAILED', `Failed to run ${cmd}`, { cmd, args }, err));
    });

    child.on('close', (code) => {
      const exitCode = code ?? 1;
      if (exitCode !== 0 && !options.allowFailure) {
        reject(
          new AppError('COMMAND_FAILED', `${cmd} exited with code ${exitCode}`, {
            cmd,
            args,
            stdout,
            stderr,
            exitCode,
          }),
        );
        return;
      }
      resolve({ stdout, stderr, exitCode, stdoutBuffer });
    });
  });
}

export function whichCmdSync(cmd: string): boolean {
  try {
    const { shell, args } = resolveWhichArgs(cmd);
    const result = runCmdSync(shell, args, { allowFailure: true });
    return result.exitCode === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

function resolveWhichArgs(cmd: string): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    return { shell: 'cmd.exe', args: ['/c', 'where', cmd] };
  }
  return { shell: 'bash', args: ['-lc', `command -v ${cmd}`] };
}
