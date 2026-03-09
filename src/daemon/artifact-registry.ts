import crypto from 'node:crypto';
import fs from 'node:fs';
import { AppError } from '../utils/errors.ts';

const ARTIFACT_CLEANUP_TIMEOUT_MS = 15 * 60 * 1000;

type ArtifactEntry = {
  artifactPath: string;
  tenantId?: string;
  fileName?: string;
  deleteAfterDownload: boolean;
  timer: ReturnType<typeof setTimeout>;
};

const pendingArtifacts = new Map<string, ArtifactEntry>();

export function trackDownloadableArtifact(params: {
  artifactPath: string;
  tenantId?: string;
  fileName?: string;
  deleteAfterDownload?: boolean;
}): string {
  const artifactId = crypto.randomUUID();
  const timer = setTimeout(() => {
    cleanupDownloadableArtifact(artifactId);
  }, ARTIFACT_CLEANUP_TIMEOUT_MS);
  pendingArtifacts.set(artifactId, {
    artifactPath: params.artifactPath,
    tenantId: params.tenantId,
    fileName: params.fileName,
    deleteAfterDownload: params.deleteAfterDownload !== false,
    timer,
  });
  return artifactId;
}

export function prepareDownloadableArtifact(
  artifactId: string,
  tenantId?: string,
): { artifactPath: string; fileName?: string; deleteAfterDownload: boolean } {
  const entry = pendingArtifacts.get(artifactId);
  if (!entry) {
    throw new AppError('INVALID_ARGS', `Artifact not found: ${artifactId}`);
  }
  if (entry.tenantId && entry.tenantId !== tenantId) {
    throw new AppError('UNAUTHORIZED', 'Artifact belongs to a different tenant');
  }
  if (!fs.existsSync(entry.artifactPath)) {
    cleanupDownloadableArtifact(artifactId);
    throw new AppError('COMMAND_FAILED', `Artifact file is missing: ${entry.artifactPath}`);
  }
  return {
    artifactPath: entry.artifactPath,
    fileName: entry.fileName,
    deleteAfterDownload: entry.deleteAfterDownload,
  };
}

export function cleanupDownloadableArtifact(artifactId: string): void {
  const entry = pendingArtifacts.get(artifactId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pendingArtifacts.delete(artifactId);
  if (!entry.deleteAfterDownload) return;
  try {
    fs.rmSync(entry.artifactPath, { force: true });
  } catch {
    // best-effort cleanup only
  }
}
