import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { AppError } from './utils/errors.ts';

const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const UPLOAD_PREFLIGHT_TIMEOUT_MS = 30 * 1000;
const ARTIFACT_HASH_ALGORITHM = 'sha256';

type UploadArtifactOptions = {
  localPath: string;
  baseUrl: string;
  token: string;
};

type UploadResponse = {
  ok: boolean;
  uploadId: string;
};

type UploadPreflightResponse = {
  ok: boolean;
  cacheHit: boolean;
  uploadId?: string;
};

export async function uploadArtifact(options: UploadArtifactOptions): Promise<string> {
  const { localPath, baseUrl, token } = options;

  const stat = fs.statSync(localPath);
  const isDirectory = stat.isDirectory();
  const filename = path.basename(localPath);
  const artifactType = isDirectory ? 'app-bundle' : 'file';

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const artifactHash = isDirectory ? undefined : await computeFileHash(localPath);
  if (artifactHash) {
    const cachedUploadId = await requestUploadPreflight({
      normalizedBase,
      token,
      hash: artifactHash,
      filename,
      sizeBytes: stat.size,
      artifactType,
    });
    if (cachedUploadId) {
      return cachedUploadId;
    }
  }

  const uploadUrl = new URL('upload', normalizedBase);
  const transport = uploadUrl.protocol === 'https:' ? https : http;

  const headers: Record<string, string> = {
    'x-artifact-type': artifactType,
    'x-artifact-filename': filename,
    'transfer-encoding': 'chunked',
  };
  if (artifactHash) {
    headers['x-artifact-hash'] = artifactHash;
    headers['x-artifact-hash-algorithm'] = ARTIFACT_HASH_ALGORITHM;
  }
  if (token) {
    headers.authorization = `Bearer ${token}`;
    headers['x-agent-device-token'] = token;
  }

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: uploadUrl.protocol,
        host: uploadUrl.hostname,
        port: uploadUrl.port,
        method: 'POST',
        path: uploadUrl.pathname + uploadUrl.search,
        headers,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          clearTimeout(timeout);
          try {
            const parsed = JSON.parse(body) as UploadResponse;
            if (!parsed.ok || !parsed.uploadId) {
              reject(new AppError('COMMAND_FAILED', `Upload failed: ${body}`));
              return;
            }
            resolve(parsed.uploadId);
          } catch {
            reject(new AppError('COMMAND_FAILED', `Invalid upload response: ${body}`));
          }
        });
      },
    );

    const timeout = setTimeout(() => {
      req.destroy();
      reject(
        new AppError('COMMAND_FAILED', 'Artifact upload timed out', {
          timeoutMs: UPLOAD_TIMEOUT_MS,
          hint: 'The upload to the remote daemon exceeded the 5-minute timeout.',
        }),
      );
    }, UPLOAD_TIMEOUT_MS);

    req.on('error', (err) => {
      clearTimeout(timeout);
      reject(
        new AppError(
          'COMMAND_FAILED',
          'Failed to upload artifact to remote daemon',
          { hint: 'Verify the remote daemon is reachable and supports artifact uploads.' },
          err,
        ),
      );
    });

    if (isDirectory) {
      const parentDir = path.dirname(localPath);
      const dirName = path.basename(localPath);
      const tar = spawn('tar', ['cf', '-', '-C', parentDir, dirName], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      tar.stdout.pipe(req);
      tar.on('error', (err) => {
        req.destroy();
        reject(
          new AppError('COMMAND_FAILED', 'Failed to create tar archive for app bundle', {}, err),
        );
      });
      tar.on('close', (code) => {
        if (code !== 0) {
          req.destroy();
          reject(new AppError('COMMAND_FAILED', `tar failed with exit code ${code}`));
        }
        // tar stdout end will trigger req.end() via pipe
      });
    } else {
      const fileStream = fs.createReadStream(localPath);
      fileStream.pipe(req);
      fileStream.on('error', (err) => {
        req.destroy();
        reject(new AppError('COMMAND_FAILED', 'Failed to read local artifact', {}, err));
      });
    }
  });
}

async function requestUploadPreflight(options: {
  normalizedBase: string;
  token: string;
  hash: string;
  filename: string;
  sizeBytes: number;
  artifactType: string;
}): Promise<string | undefined> {
  const preflightUrl = new URL('upload/preflight', options.normalizedBase);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
    headers['x-agent-device-token'] = options.token;
  }

  const response = await fetch(preflightUrl, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(UPLOAD_PREFLIGHT_TIMEOUT_MS),
    body: JSON.stringify({
      hash: options.hash,
      hashAlgorithm: ARTIFACT_HASH_ALGORITHM,
      fileName: options.filename,
      sizeBytes: options.sizeBytes,
      artifactType: options.artifactType,
    }),
  }).catch(() => undefined);

  if (!response?.ok) {
    return undefined;
  }

  const parsed = (await response.json().catch(() => undefined)) as unknown;
  return isUploadPreflightHit(parsed) ? parsed.uploadId : undefined;
}

function isUploadPreflightHit(value: unknown): value is Required<UploadPreflightResponse> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const preflight = value as UploadPreflightResponse;
  return (
    preflight.ok === true && preflight.cacheHit === true && typeof preflight.uploadId === 'string'
  );
}

async function computeFileHash(localPath: string): Promise<string> {
  const hash = createHash(ARTIFACT_HASH_ALGORITHM);
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(localPath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', (err) => {
        reject(new AppError('COMMAND_FAILED', 'Failed to read local artifact', {}, err));
      })
      .on('end', resolve);
  });
  return hash.digest('hex');
}
