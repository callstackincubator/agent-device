import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { IncomingMessage } from 'node:http';

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const TEMP_PREFIX = 'agent-device-upload-';
const UPLOAD_CLEANUP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

type UploadEntry = { cleanup: () => void; timer: ReturnType<typeof setTimeout> };
const pendingUploads = new Map<string, UploadEntry>();

export function trackUpload(artifactPath: string, cleanup: () => void): void {
  const timer = setTimeout(() => {
    pendingUploads.delete(artifactPath);
    cleanup();
  }, UPLOAD_CLEANUP_TIMEOUT_MS);
  pendingUploads.set(artifactPath, { cleanup, timer });
}

export function cleanupUploadedArtifact(artifactPath: string): void {
  const entry = pendingUploads.get(artifactPath);
  if (entry) {
    clearTimeout(entry.timer);
    pendingUploads.delete(artifactPath);
    entry.cleanup();
  }
}

function sanitizeFilename(raw: string): string {
  const basename = path.basename(raw);
  if (!basename || basename === '.' || basename === '..') {
    throw new Error(`Invalid artifact filename: ${raw}`);
  }
  return basename;
}

export async function receiveUpload(req: IncomingMessage): Promise<{ artifactPath: string; tempDir: string }> {
  const artifactType = req.headers['x-artifact-type'] as string | undefined;
  const rawFilename = req.headers['x-artifact-filename'] as string | undefined;

  if (!artifactType || !rawFilename) {
    throw new Error('Missing required headers: x-artifact-type and x-artifact-filename');
  }
  if (artifactType !== 'file' && artifactType !== 'app-bundle') {
    throw new Error(`Invalid x-artifact-type: ${artifactType}. Must be "file" or "app-bundle".`);
  }

  const artifactFilename = sanitizeFilename(rawFilename);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));

  try {
    if (artifactType === 'file') {
      const destPath = path.join(tempDir, artifactFilename);
      await streamToFile(req, destPath);
      return { artifactPath: destPath, tempDir };
    }

    // app-bundle: extract tar stream into tempDir
    await extractTar(req, tempDir);
    const destPath = path.join(tempDir, artifactFilename);
    if (!fs.existsSync(destPath)) {
      throw new Error(`Expected extracted bundle "${artifactFilename}" not found in archive`);
    }
    return { artifactPath: destPath, tempDir };
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function streamToFile(req: IncomingMessage, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(destPath);
    let bytesWritten = 0;

    req.on('data', (chunk: Buffer) => {
      bytesWritten += chunk.length;
      if (bytesWritten > MAX_UPLOAD_BYTES) {
        req.destroy(new Error(`Upload exceeds maximum size of ${MAX_UPLOAD_BYTES} bytes`));
        ws.destroy();
        return;
      }
    });

    req.pipe(ws);
    ws.on('finish', resolve);
    ws.on('error', reject);
    req.on('error', reject);
  });
}

function extractTar(req: IncomingMessage, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tar = spawn('tar', ['xf', '-', '-C', destDir], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });

    let stderr = '';
    tar.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    req.pipe(tar.stdin);

    tar.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`tar extraction failed (exit ${code}): ${stderr.trim()}`));
      }
    });

    tar.on('error', reject);
    req.on('error', (err) => {
      tar.stdin.destroy();
      reject(err);
    });
  });
}
