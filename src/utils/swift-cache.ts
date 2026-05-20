import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCmd } from './exec.ts';

const SWIFT_CACHE_VERSION = '1';

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

  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  if (!fs.existsSync(sourcePath)) {
    fs.writeFileSync(sourcePath, params.source);
  }

  await ensureSwiftExecutable({
    sourcePath,
    executablePath,
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
  timeoutMs?: number;
}): Promise<void> {
  if (isExecutableFile(params.executablePath)) {
    return;
  }

  fs.mkdirSync(path.dirname(params.executablePath), { recursive: true });
  const tempExecutablePath = `${params.executablePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await runCmd('xcrun', ['swiftc', params.sourcePath, '-o', tempExecutablePath], {
      timeoutMs: params.timeoutMs ?? 120_000,
      env: buildSwiftToolEnv(),
    });
    if (!isExecutableFile(params.executablePath)) {
      fs.renameSync(tempExecutablePath, params.executablePath);
    }
  } finally {
    fs.rmSync(tempExecutablePath, { force: true });
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
