import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from './errors.ts';
import { runCmd } from './exec.ts';

const SWIFT_CACHE_VERSION = '2';
const LOCK_RETRY_DELAY_MS = 25;

export function buildSwiftToolEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const root = getSwiftCacheRoot();
  const homePath = path.join(root, 'home');
  const moduleCachePath = path.join(root, 'module-cache');
  fs.mkdirSync(homePath, { recursive: true });
  fs.mkdirSync(moduleCachePath, { recursive: true });
  return {
    ...env,
    HOME: homePath,
    CLANG_MODULE_CACHE_PATH: moduleCachePath,
  };
}

export async function compileSwiftSourceFile(params: {
  sourcePath: string;
  cacheName?: string;
  timeoutMs?: number;
}): Promise<string> {
  const stat = fs.statSync(params.sourcePath);
  const source = fs.readFileSync(params.sourcePath);
  const cacheName = sanitizeCacheName(
    params.cacheName ?? path.basename(params.sourcePath, path.extname(params.sourcePath)),
  );
  const key = hashParts([
    SWIFT_CACHE_VERSION,
    process.platform,
    process.arch,
    path.resolve(params.sourcePath),
    stat.size,
    source,
  ]);
  const executablePath = path.join(getSwiftCacheRoot(), 'bin', `${cacheName}-${key}`);
  await ensureSwiftExecutable({
    sourcePath: params.sourcePath,
    executablePath,
    timeoutMs: params.timeoutMs,
  });
  return executablePath;
}

export async function compileSwiftSourceText(params: {
  source: string;
  cacheName: string;
  timeoutMs?: number;
}): Promise<string> {
  const cacheName = sanitizeCacheName(params.cacheName);
  const key = hashParts([SWIFT_CACHE_VERSION, process.platform, process.arch, params.source]);
  const sourcePath = path.join(getSwiftCacheRoot(), 'sources', `${cacheName}-${key}.swift`);
  const executablePath = path.join(getSwiftCacheRoot(), 'bin', `${cacheName}-${key}`);

  await ensureSwiftExecutable({
    sourcePath,
    executablePath,
    sourceText: params.source,
    timeoutMs: params.timeoutMs,
  });
  return executablePath;
}

function getSwiftCacheRoot(): string {
  const configured = process.env.AGENT_DEVICE_SWIFT_CACHE_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(os.tmpdir(), 'agent-device-swift-cache');
}

async function ensureSwiftExecutable(params: {
  sourcePath: string;
  executablePath: string;
  sourceText?: string;
  timeoutMs?: number;
}): Promise<void> {
  if (isExecutableFile(params.executablePath)) {
    return;
  }

  const executableDir = path.dirname(params.executablePath);
  fs.mkdirSync(executableDir, { recursive: true });
  const lockDir = `${params.executablePath}.lock`;
  if (!(await acquireSwiftCacheLock(lockDir, params.executablePath, params.timeoutMs ?? 120_000))) {
    return;
  }

  const tempDir = fs.mkdtempSync(
    path.join(executableDir, `.${path.basename(params.executablePath)}.${process.pid}.`),
  );
  const tempExecutablePath = path.join(tempDir, path.basename(params.executablePath));
  try {
    if (isExecutableFile(params.executablePath)) {
      return;
    }
    if (params.sourceText !== undefined && !fs.existsSync(params.sourcePath)) {
      fs.mkdirSync(path.dirname(params.sourcePath), { recursive: true });
      fs.writeFileSync(params.sourcePath, params.sourceText);
    }
    await runCmd('xcrun', ['swiftc', params.sourcePath, '-o', tempExecutablePath], {
      timeoutMs: params.timeoutMs ?? 120_000,
      env: buildSwiftToolEnv(),
    });
    fs.renameSync(tempExecutablePath, params.executablePath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

async function acquireSwiftCacheLock(
  lockDir: string,
  executablePath: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (isExecutableFile(executablePath)) {
      return false;
    }
    try {
      fs.mkdirSync(lockDir);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw error;
      }
      if (isStaleSwiftCacheLock(lockDir, timeoutMs)) {
        fs.rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new AppError(
          'COMMAND_FAILED',
          `Timed out waiting for Swift cache lock: ${lockDir} (${timeoutMs}ms)`,
          {
            lockDir,
            timeoutMs,
            hint: `Another agent-device process may still be compiling this Swift helper. Retry shortly; if no agent-device process is active, remove "${lockDir}" and retry.`,
          },
        );
      }
      await delay(LOCK_RETRY_DELAY_MS);
    }
  }
}

function isStaleSwiftCacheLock(lockDir: string, timeoutMs: number): boolean {
  try {
    return Date.now() - fs.statSync(lockDir).mtimeMs >= timeoutMs;
  } catch {
    return false;
  }
}

function isExecutableFile(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function sanitizeCacheName(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/g, '-').replaceAll(/^-+|-+$/g, '') || 'swift-helper';
}

function hashParts(parts: Array<string | number | Buffer>): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(Buffer.isBuffer(part) ? part : String(part));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}
