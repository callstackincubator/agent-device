import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppError } from '../utils/errors.ts';
import { runCmd } from '../utils/exec.ts';
import { resolveTimeoutMs } from '../utils/timeouts.ts';

export type MaterializeInstallSource =
  | {
    kind: 'url';
    url: string;
    headers?: Record<string, string>;
  }
  | {
    kind: 'path';
    path: string;
  };

type MaterializeLocalSourceResult = {
  localPath: string;
  cleanup: () => Promise<void>;
};

type MaterializeInstallableOptions = {
  source: MaterializeInstallSource;
  isInstallablePath: (candidatePath: string, stat: { isFile(): boolean; isDirectory(): boolean }) => boolean;
  installableLabel: string;
  signal?: AbortSignal;
  downloadTimeoutMs?: number;
};

export type MaterializedInstallable = {
  archivePath?: string;
  installablePath: string;
  cleanup: () => Promise<void>;
};

const ARCHIVE_EXTENSIONS = ['.zip', '.tar', '.tar.gz', '.tgz'] as const;
const DEFAULT_SOURCE_DOWNLOAD_TIMEOUT_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_SOURCE_DOWNLOAD_TIMEOUT_MS,
  120_000,
  1_000,
);

export async function materializeInstallablePath(
  options: MaterializeInstallableOptions,
): Promise<MaterializedInstallable> {
  const cleanupTasks: Array<() => Promise<void>> = [];
  try {
    const localSource = await materializeLocalSource(options.source, {
      signal: options.signal,
      downloadTimeoutMs: options.downloadTimeoutMs,
    });
    cleanupTasks.push(localSource.cleanup);
    const resolved = await resolveInstallableCandidate(localSource.localPath, {
      archivePath: undefined,
      isInstallablePath: options.isInstallablePath,
      installableLabel: options.installableLabel,
      registerCleanup: (cleanup) => {
        cleanupTasks.push(cleanup);
      },
    });
    return {
      archivePath: resolved.archivePath,
      installablePath: resolved.installablePath,
      cleanup: async () => {
        await runCleanupTasks(cleanupTasks);
      },
    };
  } catch (error) {
    await runCleanupTasks(cleanupTasks);
    throw error;
  }
}

export function expandSourcePath(inputPath: string): string {
  if (!inputPath.startsWith('~')) return inputPath;
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/')) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

async function materializeLocalSource(
  source: MaterializeInstallSource,
  options?: { signal?: AbortSignal; downloadTimeoutMs?: number },
): Promise<MaterializeLocalSourceResult> {
  if (source.kind === 'path') {
    return {
      localPath: expandSourcePath(source.path),
      cleanup: async () => {},
    };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-source-'));
  try {
    const downloadedPath = await downloadToTempFile(tempDir, source.url, source.headers, options);
    return {
      localPath: downloadedPath,
      cleanup: async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function downloadToTempFile(
  tempDir: string,
  url: string,
  headers?: Record<string, string>,
  options?: { signal?: AbortSignal; downloadTimeoutMs?: number },
): Promise<string> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new AppError('INVALID_ARGS', `Invalid source URL: ${url}`);
  }
  const requestSignal = options?.signal;
  if (requestSignal?.aborted) {
    throw new AppError('COMMAND_FAILED', 'request canceled', { reason: 'request_canceled' });
  }
  const controller = new AbortController();
  const onAbort = () => {
    controller.abort(requestSignal?.reason);
  };
  requestSignal?.addEventListener('abort', onAbort, { once: true });
  const timeoutMs = options?.downloadTimeoutMs ?? DEFAULT_SOURCE_DOWNLOAD_TIMEOUT_MS;
  const timeoutHandle = setTimeout(() => {
    controller.abort(new Error('download timeout'));
  }, timeoutMs);
  let response: Response;
  try {
    response = await fetch(parsedUrl, {
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (error) {
    requestSignal?.removeEventListener('abort', onAbort);
    clearTimeout(timeoutHandle);
    if (requestSignal?.aborted) {
      throw new AppError('COMMAND_FAILED', 'request canceled', { reason: 'request_canceled' }, error);
    }
    if (controller.signal.aborted) {
      throw new AppError('COMMAND_FAILED', `App source download timed out after ${timeoutMs}ms`, {
        timeoutMs,
        url: parsedUrl.toString(),
      }, error);
    }
    throw error;
  }
  requestSignal?.removeEventListener('abort', onAbort);
  clearTimeout(timeoutHandle);
  if (!response.ok) {
    throw new AppError('COMMAND_FAILED', `Failed to download app source: ${response.status} ${response.statusText}`, {
      status: response.status,
      statusText: response.statusText,
      url: parsedUrl.toString(),
    });
  }
  const downloadName = resolveDownloadFileName(response, parsedUrl);
  const destinationPath = path.join(tempDir, downloadName);
  const body = response.body;
  if (!body) {
    throw new AppError('COMMAND_FAILED', 'Download response body was empty', {
      url: parsedUrl.toString(),
    });
  }
  const file = await fs.open(destinationPath, 'w');
  try {
    for await (const chunk of body) {
      await file.write(chunk);
    }
  } finally {
    await file.close();
  }
  return destinationPath;
}

function resolveDownloadFileName(response: Response, parsedUrl: URL): string {
  const contentDisposition = response.headers.get('content-disposition');
  const filenameMatch = contentDisposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const headerName = filenameMatch?.[1]?.trim();
  if (headerName) return path.basename(headerName);
  const urlName = path.basename(parsedUrl.pathname);
  if (urlName) return urlName;
  return 'downloaded-artifact.bin';
}

async function resolveInstallableCandidate(
  candidatePath: string,
  params: {
    archivePath: string | undefined;
    isInstallablePath: MaterializeInstallableOptions['isInstallablePath'];
    installableLabel: string;
    registerCleanup: (cleanup: () => Promise<void>) => void;
  },
): Promise<{ archivePath?: string; installablePath: string }> {
  const stat = await fs.stat(candidatePath).catch(() => null);
  if (!stat) {
    throw new AppError('INVALID_ARGS', `App source not found: ${candidatePath}`);
  }

  if (params.isInstallablePath(candidatePath, stat)) {
    return {
      archivePath: params.archivePath,
      installablePath: candidatePath,
    };
  }

  if (stat.isFile() && isArchivePath(candidatePath)) {
    const extracted = await extractArchive(candidatePath);
    params.registerCleanup(extracted.cleanup);
    return await resolveInstallableCandidate(extracted.outputPath, {
      ...params,
      archivePath: params.archivePath ?? candidatePath,
    });
  }

  if (stat.isDirectory()) {
    const installables = await collectMatchingPaths(candidatePath, params.isInstallablePath);
    if (installables.length === 1) {
      return {
        archivePath: params.archivePath,
        installablePath: installables[0],
      };
    }
    if (installables.length > 1) {
      throw new AppError(
        'INVALID_ARGS',
        `Found multiple ${params.installableLabel} candidates under ${candidatePath}`,
        { matches: installables },
      );
    }

    const archives = await collectMatchingPaths(candidatePath, (entryPath, entryStat) =>
      entryStat.isFile() && isArchivePath(entryPath));
    if (archives.length === 1) {
      const extracted = await extractArchive(archives[0]);
      params.registerCleanup(extracted.cleanup);
      return await resolveInstallableCandidate(extracted.outputPath, {
        ...params,
        archivePath: params.archivePath ?? archives[0],
      });
    }
    if (archives.length > 1) {
      throw new AppError(
        'INVALID_ARGS',
        `Found multiple nested archives under ${candidatePath}; expected one ${params.installableLabel} source`,
        { matches: archives },
      );
    }
  }

  throw new AppError(
    'INVALID_ARGS',
    `Expected ${params.installableLabel} source, but got ${candidatePath}`,
  );
}

async function collectMatchingPaths(
  rootPath: string,
  matcher: (candidatePath: string, stat: { isFile(): boolean; isDirectory(): boolean }) => boolean,
): Promise<string[]> {
  const matches: string[] = [];
  const queue: string[] = [rootPath];

  while (queue.length > 0) {
    const currentPath = queue.shift();
    if (!currentPath) continue;
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (matcher(entryPath, entry)) {
        matches.push(entryPath);
        continue;
      }
      if (entry.isDirectory()) {
        queue.push(entryPath);
      }
    }
  }

  return matches;
}

async function extractArchive(
  archivePath: string,
): Promise<{ outputPath: string; cleanup: () => Promise<void> }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-archive-'));
  try {
    if (archivePath.toLowerCase().endsWith('.zip')) {
      await runCmd('ditto', ['-x', '-k', archivePath, tempDir]);
    } else if (archivePath.toLowerCase().endsWith('.tar.gz') || archivePath.toLowerCase().endsWith('.tgz')) {
      await runCmd('tar', ['-xzf', archivePath, '-C', tempDir]);
    } else {
      await runCmd('tar', ['-xf', archivePath, '-C', tempDir]);
    }
    return {
      outputPath: tempDir,
      cleanup: async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function isArchivePath(candidatePath: string): boolean {
  const lower = candidatePath.toLowerCase();
  return ARCHIVE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

async function runCleanupTasks(tasks: Array<() => Promise<void>>): Promise<void> {
  for (let index = tasks.length - 1; index >= 0; index -= 1) {
    await tasks[index]();
  }
}
