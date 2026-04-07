import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { findProjectRoot } from '../utils/version.ts';

export function resolveDaemonCodeSignature(
  entryPath: string | undefined = process.argv[1],
  root: string = findProjectRoot(),
): string {
  if (!entryPath) return 'unknown';
  return computeDaemonCodeSignature(entryPath, root);
}

export function computeDaemonCodeSignature(
  entryPath: string,
  root: string = findProjectRoot(),
): string {
  const targetPath = resolveDaemonCodeSignatureTarget(entryPath, root);
  try {
    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      return formatSingleFileSignature(targetPath, stat, root);
    }

    const hash = crypto.createHash('sha256');
    let fileCount = 0;
    for (const filePath of walkSignatureFiles(targetPath)) {
      const fileStat = fs.statSync(filePath);
      const relativePath = path.relative(root, filePath) || path.basename(filePath);
      hash.update(
        `${relativePath}:${fileStat.size}:${Math.trunc(fileStat.mtimeMs)}:${fileStat.mode}\n`,
      );
      fileCount += 1;
    }

    const relativeTarget = path.relative(root, targetPath) || path.basename(targetPath);
    return `${relativeTarget}:${fileCount}:${hash.digest('hex').slice(0, 16)}`;
  } catch {
    return 'unknown';
  }
}

function resolveDaemonCodeSignatureTarget(entryPath: string, root: string): string {
  const resolvedEntryPath = path.resolve(entryPath);
  const sourceDaemonEntry = path.join(root, 'src', 'daemon.ts');
  const distDaemonEntry = path.join(root, 'dist', 'src', 'daemon.js');
  if (resolvedEntryPath === sourceDaemonEntry) {
    return path.join(root, 'src');
  }
  if (resolvedEntryPath === distDaemonEntry) {
    return path.join(root, 'dist', 'src');
  }
  return resolvedEntryPath;
}

function formatSingleFileSignature(filePath: string, stat: fs.Stats, root: string): string {
  const relativePath = path.relative(root, filePath) || path.basename(filePath);
  return `${relativePath}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
}

function* walkSignatureFiles(dirPath: string): Generator<string> {
  const entries = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      yield* walkSignatureFiles(entryPath);
      continue;
    }
    if (entry.isFile()) {
      yield entryPath;
    }
  }
}
