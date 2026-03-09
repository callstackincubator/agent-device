import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { AppError } from '../utils/errors.ts';
import { runCmd } from '../utils/exec.ts';

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const TEMP_PREFIX = 'agent-device-upload-';
const UPLOAD_CLEANUP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

type UploadEntry = {
  artifactPath: string;
  tempDir: string;
  tenantId?: string;
  claimed: boolean;
  timer: ReturnType<typeof setTimeout>;
};

const pendingUploads = new Map<string, UploadEntry>();

export function trackUploadedArtifact(params: {
  artifactPath: string;
  tempDir: string;
  tenantId?: string;
}): string {
  const uploadId = crypto.randomUUID();
  const timer = setTimeout(() => {
    cleanupUploadedArtifact(uploadId);
  }, UPLOAD_CLEANUP_TIMEOUT_MS);
  pendingUploads.set(uploadId, {
    artifactPath: params.artifactPath,
    tempDir: params.tempDir,
    tenantId: params.tenantId,
    claimed: false,
    timer,
  });
  return uploadId;
}

export function prepareUploadedArtifact(uploadId: string, tenantId?: string): string {
  const entry = pendingUploads.get(uploadId);
  if (!entry) {
    throw new AppError('INVALID_ARGS', `Uploaded artifact not found: ${uploadId}`);
  }
  if (entry.tenantId && entry.tenantId !== tenantId) {
    throw new AppError('UNAUTHORIZED', 'Uploaded artifact belongs to a different tenant');
  }
  clearTimeout(entry.timer);
  entry.claimed = true;
  return entry.artifactPath;
}

export function cleanupUploadedArtifact(uploadId: string): void {
  const entry = pendingUploads.get(uploadId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pendingUploads.delete(uploadId);
  fs.rmSync(entry.tempDir, { recursive: true, force: true });
}

function sanitizeFilename(raw: string): string {
  const basename = path.basename(raw);
  if (!basename || basename === '.' || basename === '..') {
    throw new AppError('INVALID_ARGS', `Invalid artifact filename: ${raw}`);
  }
  return basename;
}

export async function receiveUpload(req: IncomingMessage): Promise<{ artifactPath: string; tempDir: string }> {
  const artifactType = req.headers['x-artifact-type'] as string | undefined;
  const rawFilename = req.headers['x-artifact-filename'] as string | undefined;

  if (!artifactType || !rawFilename) {
    throw new AppError('INVALID_ARGS', 'Missing required headers: x-artifact-type and x-artifact-filename');
  }
  if (artifactType !== 'file' && artifactType !== 'app-bundle') {
    throw new AppError('INVALID_ARGS', `Invalid x-artifact-type: ${artifactType}. Must be "file" or "app-bundle".`);
  }

  validateContentLength(req);
  const artifactFilename = sanitizeFilename(rawFilename);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));

  try {
    if (artifactType === 'file') {
      const destPath = path.join(tempDir, artifactFilename);
      await streamToFile(req, destPath);
      return { artifactPath: destPath, tempDir };
    }

    const archivePath = path.join(tempDir, 'artifact.tar');
    await streamToFile(req, archivePath);
    await validateTarArchive(archivePath, artifactFilename);
    await runCmd('tar', ['xf', archivePath, '-C', tempDir]);
    fs.rmSync(archivePath, { force: true });

    const destPath = path.join(tempDir, artifactFilename);
    if (!fs.existsSync(destPath)) {
      throw new AppError('INVALID_ARGS', `Expected extracted bundle "${artifactFilename}" not found in archive`);
    }
    return { artifactPath: destPath, tempDir };
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function validateContentLength(req: IncomingMessage): void {
  const rawLength = req.headers['content-length'];
  if (typeof rawLength !== 'string') return;
  const parsed = Number(rawLength);
  if (Number.isFinite(parsed) && parsed > MAX_UPLOAD_BYTES) {
    throw new AppError('INVALID_ARGS', `Upload exceeds maximum size of ${MAX_UPLOAD_BYTES} bytes`);
  }
}

function streamToFile(req: IncomingMessage, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(destPath);
    let settled = false;
    let bytesWritten = 0;

    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    req.on('data', (chunk: Buffer) => {
      bytesWritten += chunk.length;
      if (bytesWritten > MAX_UPLOAD_BYTES) {
        const error = new AppError('INVALID_ARGS', `Upload exceeds maximum size of ${MAX_UPLOAD_BYTES} bytes`);
        req.destroy(error);
        ws.destroy(error);
      }
    });

    req.pipe(ws);
    ws.on('finish', resolveOnce);
    ws.on('error', rejectOnce);
    req.on('error', rejectOnce);
  });
}

async function validateTarArchive(archivePath: string, artifactFilename: string): Promise<void> {
  const entriesResult = await runCmd('tar', ['-tf', archivePath]);
  const entries = entriesResult.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    throw new AppError('INVALID_ARGS', 'Uploaded app bundle archive is empty');
  }

  const hasExpectedRoot = entries.some((entry) => entry === artifactFilename || entry.startsWith(`${artifactFilename}/`));
  if (!hasExpectedRoot) {
    throw new AppError('INVALID_ARGS', `Uploaded archive must contain a top-level "${artifactFilename}" bundle`);
  }

  for (const entry of entries) {
    validateArchiveEntryPath(entry, artifactFilename);
  }

  const verboseResult = await runCmd('tar', ['-tvf', archivePath]);
  const lines = verboseResult.stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const entryType = line[0];
    if (entryType === 'l' || entryType === 'h') {
      throw new AppError('INVALID_ARGS', 'Uploaded app bundle archive cannot contain symlinks or hard links');
    }
  }
}

function validateArchiveEntryPath(entry: string, artifactFilename: string): void {
  if (entry.includes('\0')) {
    throw new AppError('INVALID_ARGS', `Invalid archive entry: ${entry}`);
  }
  if (path.posix.isAbsolute(entry)) {
    throw new AppError('INVALID_ARGS', `Archive entry must be relative: ${entry}`);
  }
  const normalized = path.posix.normalize(entry).replace(/^\.\/+/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../')) {
    throw new AppError('INVALID_ARGS', `Archive entry escapes bundle root: ${entry}`);
  }
  if (normalized !== artifactFilename && !normalized.startsWith(`${artifactFilename}/`)) {
    throw new AppError('INVALID_ARGS', `Archive entry must stay inside top-level "${artifactFilename}" bundle: ${entry}`);
  }
}
