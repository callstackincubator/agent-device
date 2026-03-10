import crypto from 'node:crypto';
import fs from 'node:fs';
import { AppError } from '../utils/errors.ts';

const UPLOAD_CLEANUP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

type UploadEntry = {
  artifactPath: string;
  tempDir: string;
  tenantId?: string;
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
  timer.unref?.();
  pendingUploads.set(uploadId, {
    artifactPath: params.artifactPath,
    tempDir: params.tempDir,
    tenantId: params.tenantId,
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
  return entry.artifactPath;
}

export function cleanupUploadedArtifact(uploadId: string): void {
  const entry = pendingUploads.get(uploadId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pendingUploads.delete(uploadId);
  fs.rmSync(entry.tempDir, { recursive: true, force: true });
}
