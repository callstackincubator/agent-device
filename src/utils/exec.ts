import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync, type StdioOptions } from 'node:child_process';
import { AppError } from './errors.ts';

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  stdoutBuffer?: Buffer;
};

type ExecOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  allowFailure?: boolean;
  binaryStdout?: boolean;
  stdin?: string | Buffer;
  timeoutMs?: number;
  detached?: boolean;
};

type ExecStreamOptions = ExecOptions & {
  onStdoutChunk?: (chunk: string) => void;
  onStderrChunk?: (chunk: string) => void;
  onSpawn?: (child: ReturnType<typeof spawn>) => void;
};

export type ExecBackgroundResult = {
  child: ReturnType<typeof spawn>;
  wait: Promise<ExecResult>;
};

type ExecDetachedOptions = ExecOptions & {
  stdio?: StdioOptions;
};

const BARE_COMMAND_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const WINDOWS_PATH_EXTENSIONS = ['.com', '.exe', '.bat', '.cmd'];

export async function runCmd(
  cmd: string,
  args: string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  const executable = normalizeExecutableCommand(cmd);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: options.detached,
      shell: false,
    });

    let stdout = '';
    let stdoutBuffer: Buffer | undefined = options.binaryStdout ? Buffer.alloc(0) : undefined;
    let stderr = '';
    let didTimeout = false;
    const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
    const timeoutHandle = timeoutMs
      ? setTimeout(() => {
          didTimeout = true;
          child.kill('SIGKILL');
        }, timeoutMs)
      : null;

    if (!options.binaryStdout) child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    if (options.stdin !== undefined) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();

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
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        reject(new AppError('TOOL_MISSING', `${executable} not found in PATH`, { cmd }, err));
        return;
      }
      reject(new AppError('COMMAND_FAILED', `Failed to run ${executable}`, { cmd, args }, err));
    });

    child.on('close', (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const exitCode = code ?? 1;
      if (didTimeout && timeoutMs) {
        reject(
          new AppError('COMMAND_FAILED', `${executable} timed out after ${timeoutMs}ms`, {
            cmd,
            args,
            stdout,
            stderr,
            exitCode,
            timeoutMs,
          }),
        );
        return;
      }
      if (exitCode !== 0 && !options.allowFailure) {
        reject(
          new AppError('COMMAND_FAILED', `${executable} exited with code ${exitCode}`, {
            cmd,
            args,
            stdout,
            stderr,
            exitCode,
            processExitError: true,
          }),
        );
        return;
      }
      resolve({ stdout, stderr, exitCode, stdoutBuffer });
    });
  });
}

export async function whichCmd(cmd: string): Promise<boolean> {
  const candidate = normalizeExecutableLookup(cmd);
  if (!candidate) return false;

  if (path.isAbsolute(candidate)) {
    return isExecutable(candidate);
  }

  const pathValue = process.env.PATH;
  if (!pathValue) return false;
  const pathExtensions = resolvePathExtensions();
  for (const directory of pathValue.split(path.delimiter)) {
    const trimmedDirectory = directory.trim();
    if (!trimmedDirectory) continue;
    for (const entry of resolveExecutableCandidates(candidate, pathExtensions)) {
      if (await isExecutable(path.join(trimmedDirectory, entry))) {
        return true;
      }
    }
  }

  return false;
}

export function runCmdSync(cmd: string, args: string[], options: ExecOptions = {}): ExecResult {
  const executable = normalizeExecutableCommand(cmd);
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: options.binaryStdout ? undefined : 'utf8',
    input: options.stdin,
    timeout: normalizeTimeoutMs(options.timeoutMs),
    shell: false,
  });

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ETIMEDOUT') {
      throw new AppError(
        'COMMAND_FAILED',
        `${executable} timed out after ${normalizeTimeoutMs(options.timeoutMs)}ms`,
        {
          cmd,
          args,
          timeoutMs: normalizeTimeoutMs(options.timeoutMs),
        },
        result.error,
      );
    }
    if (code === 'ENOENT') {
      throw new AppError('TOOL_MISSING', `${executable} not found in PATH`, { cmd }, result.error);
    }
    throw new AppError(
      'COMMAND_FAILED',
      `Failed to run ${executable}`,
      { cmd, args },
      result.error,
    );
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
    throw new AppError('COMMAND_FAILED', `${executable} exited with code ${exitCode}`, {
      cmd,
      args,
      stdout,
      stderr,
      exitCode,
      processExitError: true,
    });
  }

  return { stdout, stderr, exitCode, stdoutBuffer };
}

export function runCmdDetached(
  cmd: string,
  args: string[],
  options: ExecDetachedOptions = {},
): number {
  const executable = normalizeExecutableCommand(cmd);
  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio ?? 'ignore',
    detached: true,
    shell: false,
  });
  child.unref();
  return child.pid ?? 0;
}

export async function runCmdStreaming(
  cmd: string,
  args: string[],
  options: ExecStreamOptions = {},
): Promise<ExecResult> {
  const executable = normalizeExecutableCommand(cmd);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: options.detached,
      shell: false,
    });
    options.onSpawn?.(child);

    let stdout = '';
    let stderr = '';
    let stdoutBuffer: Buffer | undefined = options.binaryStdout ? Buffer.alloc(0) : undefined;
    let didTimeout = false;
    const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
    const timeoutHandle = timeoutMs
      ? setTimeout(() => {
          didTimeout = true;
          child.kill('SIGKILL');
        }, timeoutMs)
      : null;

    if (!options.binaryStdout) child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    if (options.stdin !== undefined) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();

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
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        reject(new AppError('TOOL_MISSING', `${executable} not found in PATH`, { cmd }, err));
        return;
      }
      reject(new AppError('COMMAND_FAILED', `Failed to run ${executable}`, { cmd, args }, err));
    });

    child.on('close', (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const exitCode = code ?? 1;
      if (didTimeout && timeoutMs) {
        reject(
          new AppError('COMMAND_FAILED', `${executable} timed out after ${timeoutMs}ms`, {
            cmd,
            args,
            stdout,
            stderr,
            exitCode,
            timeoutMs,
          }),
        );
        return;
      }
      if (exitCode !== 0 && !options.allowFailure) {
        reject(
          new AppError('COMMAND_FAILED', `${executable} exited with code ${exitCode}`, {
            cmd,
            args,
            stdout,
            stderr,
            exitCode,
            processExitError: true,
          }),
        );
        return;
      }
      resolve({ stdout, stderr, exitCode, stdoutBuffer });
    });
  });
}

export function runCmdBackground(
  cmd: string,
  args: string[],
  options: ExecOptions = {},
): ExecBackgroundResult {
  const executable = normalizeExecutableCommand(cmd);
  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: options.detached,
    shell: false,
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

  const wait = new Promise<ExecResult>((resolve, reject) => {
    child.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        reject(new AppError('TOOL_MISSING', `${executable} not found in PATH`, { cmd }, err));
        return;
      }
      reject(new AppError('COMMAND_FAILED', `Failed to run ${executable}`, { cmd, args }, err));
    });
    child.on('close', (code) => {
      const exitCode = code ?? 1;
      if (exitCode !== 0 && !options.allowFailure) {
        reject(
          new AppError('COMMAND_FAILED', `${executable} exited with code ${exitCode}`, {
            cmd,
            args,
            stdout,
            stderr,
            exitCode,
            processExitError: true,
          }),
        );
        return;
      }
      resolve({ stdout, stderr, exitCode });
    });
  });

  return { child, wait };
}

function normalizeExecutableCommand(cmd: string): string {
  const candidate = normalizeExecutableLookup(cmd);
  if (!candidate) {
    throw new AppError('INVALID_ARGS', `Invalid executable command: ${JSON.stringify(cmd)}`, {
      cmd,
    });
  }
  return candidate;
}

function normalizeExecutableLookup(cmd: string): string | null {
  const candidate = cmd.trim();
  if (!candidate || candidate.includes('\0')) return null;
  if (path.isAbsolute(candidate)) return candidate;
  if (candidate.includes('/') || candidate.includes('\\')) return null;
  return BARE_COMMAND_RE.test(candidate) ? candidate : null;
}

function resolvePathExtensions(): string[] {
  if (process.platform !== 'win32') return [''];
  const rawPathExt = process.env.PATHEXT;
  if (!rawPathExt) return WINDOWS_PATH_EXTENSIONS;
  const extensions = rawPathExt
    .split(';')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  return extensions.length > 0 ? extensions : WINDOWS_PATH_EXTENSIONS;
}

function resolveExecutableCandidates(cmd: string, pathExtensions: string[]): string[] {
  if (process.platform !== 'win32') return [cmd];
  const lowered = cmd.toLowerCase();
  if (pathExtensions.some((extension) => lowered.endsWith(extension))) {
    return [cmd];
  }
  return pathExtensions.map((extension) => `${cmd}${extension}`);
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeTimeoutMs(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const timeout = Math.floor(value as number);
  if (timeout <= 0) return undefined;
  return timeout;
}
