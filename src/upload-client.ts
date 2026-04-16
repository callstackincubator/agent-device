import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { AppError } from './utils/errors.ts';
import { runCmd } from './utils/exec.ts';

const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const UPLOAD_PREFLIGHT_TIMEOUT_MS = 30 * 1000;
const ARTIFACT_HASH_ALGORITHM = 'sha256';
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

type UploadArtifactOptions = {
  localPath: string;
  baseUrl: string;
  token: string;
  platform?: 'ios' | 'android';
};

type PreparedUploadArtifact = {
  payloadPath: string;
  fileName: string;
  artifactType: 'app-bundle' | 'file';
  platform?: 'ios' | 'android';
  contentType: string;
  sha256: string;
  sizeBytes: number;
  cleanup: () => void;
};

type UploadResponse = {
  ok: boolean;
  uploadId: string;
};

type UploadPreflightCacheHitResponse = {
  ok: boolean;
  cacheHit: boolean;
  uploadId?: string;
};

type UploadPreflightDirectResponse = {
  ok: boolean;
  cacheHit?: boolean;
  uploadId?: string;
  upload?: {
    url?: string;
    headers?: Record<string, string>;
  };
};

type UploadPreflightResult =
  | {
      kind: 'cache-hit';
      uploadId: string;
    }
  | {
      kind: 'direct-upload';
      uploadId: string;
      url: string;
      headers: Record<string, string>;
    };

export async function uploadArtifact(options: UploadArtifactOptions): Promise<string> {
  const prepared = await prepareUploadArtifact(options.localPath, options.platform);
  const normalizedBase = options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`;

  try {
    const preflight = await requestUploadPreflight({
      normalizedBase,
      token: options.token,
      artifact: prepared,
    });

    if (preflight?.kind === 'cache-hit') {
      return preflight.uploadId;
    }
    if (preflight?.kind === 'direct-upload') {
      await uploadDirectArtifact(prepared.payloadPath, preflight);
      return await finalizeDirectUpload({
        normalizedBase,
        token: options.token,
        uploadId: preflight.uploadId,
      });
    }

    return await uploadLegacyArtifact({
      normalizedBase,
      token: options.token,
      artifact: prepared,
    });
  } finally {
    prepared.cleanup();
  }
}

async function prepareUploadArtifact(
  localPath: string,
  requestedPlatform: 'ios' | 'android' | undefined,
): Promise<PreparedUploadArtifact> {
  const stat = fs.statSync(localPath);
  const fileName = path.basename(localPath);
  const isDirectory = stat.isDirectory();
  const platform = requestedPlatform ?? inferArtifactPlatform(localPath, stat);
  const cleanupPaths: string[] = [];
  try {
    const payloadPath = isDirectory
      ? await createGzipTarArchive(localPath, cleanupPaths)
      : localPath;
    const payloadStat = fs.statSync(payloadPath);

    return {
      payloadPath,
      fileName,
      artifactType: isDirectory ? 'app-bundle' : 'file',
      platform,
      contentType: isDirectory ? 'application/gzip' : DEFAULT_CONTENT_TYPE,
      sha256: await computeFileHash(payloadPath),
      sizeBytes: payloadStat.size,
      cleanup: () => cleanupUploadPaths(cleanupPaths),
    };
  } catch (error) {
    cleanupUploadPaths(cleanupPaths);
    throw error;
  }
}

async function createGzipTarArchive(localPath: string, cleanupPaths: string[]): Promise<string> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `agent-device-upload-${randomUUID()}-`));
  cleanupPaths.push(tempDir);
  const archivePath = path.join(tempDir, `${path.basename(localPath)}.tar.gz`);
  await runCmd('tar', [
    'czf',
    archivePath,
    '-C',
    path.dirname(localPath),
    path.basename(localPath),
  ]);
  return archivePath;
}

function inferArtifactPlatform(
  localPath: string,
  stat: { isDirectory(): boolean },
): 'ios' | 'android' | undefined {
  const lowered = localPath.toLowerCase();
  if (stat.isDirectory() && lowered.endsWith('.app')) return 'ios';
  if (lowered.endsWith('.ipa')) return 'ios';
  if (lowered.endsWith('.apk') || lowered.endsWith('.aab')) return 'android';
  return undefined;
}

function cleanupUploadPaths(cleanupPaths: string[]): void {
  for (const cleanupPath of cleanupPaths) {
    fs.rmSync(cleanupPath, { recursive: true, force: true });
  }
}

async function uploadLegacyArtifact(options: {
  normalizedBase: string;
  token: string;
  artifact: PreparedUploadArtifact;
}): Promise<string> {
  const { normalizedBase, token, artifact } = options;

  const uploadUrl = new URL('upload', normalizedBase);
  const transport = uploadUrl.protocol === 'https:' ? https : http;

  const headers: Record<string, string> = {
    'content-type': artifact.contentType,
    'x-artifact-type': artifact.artifactType,
    'x-artifact-filename': artifact.fileName,
    'x-artifact-hash': artifact.sha256,
    'x-artifact-hash-algorithm': ARTIFACT_HASH_ALGORITHM,
    'transfer-encoding': 'chunked',
  };
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

    const fileStream = fs.createReadStream(artifact.payloadPath);
    fileStream.pipe(req);
    fileStream.on('error', (err) => {
      req.destroy();
      reject(new AppError('COMMAND_FAILED', 'Failed to read local artifact', {}, err));
    });
  });
}

async function requestUploadPreflight(options: {
  normalizedBase: string;
  token: string;
  artifact: PreparedUploadArtifact;
}): Promise<UploadPreflightResult | undefined> {
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
      sha256: options.artifact.sha256,
      fileName: options.artifact.fileName,
      sizeBytes: options.artifact.sizeBytes,
      artifactType: options.artifact.artifactType,
      ...(options.artifact.platform ? { platform: options.artifact.platform } : {}),
      contentType: options.artifact.contentType,
    }),
  }).catch(() => undefined);

  if (!response?.ok) {
    return undefined;
  }

  const parsed = (await response.json().catch(() => undefined)) as unknown;
  if (isUploadPreflightHit(parsed)) {
    return {
      kind: 'cache-hit',
      uploadId: parsed.uploadId,
    };
  }
  if (isUploadPreflightDirectUpload(parsed)) {
    return {
      kind: 'direct-upload',
      uploadId: parsed.uploadId,
      url: parsed.upload.url,
      headers: parsed.upload.headers,
    };
  }
  return undefined;
}

function isUploadPreflightHit(value: unknown): value is Required<UploadPreflightCacheHitResponse> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const preflight = value as UploadPreflightCacheHitResponse;
  return (
    preflight.ok === true && preflight.cacheHit === true && typeof preflight.uploadId === 'string'
  );
}

function isUploadPreflightDirectUpload(
  value: unknown,
): value is Required<UploadPreflightDirectResponse> & {
  upload: { url: string; headers: Record<string, string> };
} {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const preflight = value as UploadPreflightDirectResponse;
  if (preflight.ok !== true || typeof preflight.uploadId !== 'string') {
    return false;
  }
  if (!preflight.upload || typeof preflight.upload.url !== 'string') {
    return false;
  }
  const headers = preflight.upload.headers ?? {};
  if (!isStringRecord(headers)) {
    return false;
  }
  preflight.upload.headers = headers;
  return true;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === 'string');
}

async function uploadDirectArtifact(
  payloadPath: string,
  ticket: Extract<UploadPreflightResult, { kind: 'direct-upload' }>,
): Promise<void> {
  const uploadUrl = new URL(ticket.url);
  const transport = uploadUrl.protocol === 'https:' ? https : http;

  await new Promise<void>((resolve, reject) => {
    const req = transport.request(
      {
        protocol: uploadUrl.protocol,
        host: uploadUrl.hostname,
        port: uploadUrl.port,
        method: 'PUT',
        path: uploadUrl.pathname + uploadUrl.search,
        headers: ticket.headers,
      },
      (res) => {
        res.resume();
        res.on('end', () => {
          const statusCode = res.statusCode ?? 500;
          if (statusCode < 200 || statusCode >= 300) {
            reject(
              new AppError('COMMAND_FAILED', 'Direct artifact upload failed', {
                statusCode,
                statusMessage: res.statusMessage,
              }),
            );
            return;
          }
          resolve();
        });
      },
    );

    const timeout = setTimeout(() => {
      req.destroy();
      reject(
        new AppError('COMMAND_FAILED', 'Direct artifact upload timed out', {
          timeoutMs: UPLOAD_TIMEOUT_MS,
          hint: 'The direct upload ticket did not accept the artifact within the timeout.',
        }),
      );
    }, UPLOAD_TIMEOUT_MS);

    req.on('error', (err) => {
      clearTimeout(timeout);
      reject(
        new AppError(
          'COMMAND_FAILED',
          'Failed to upload artifact with direct upload ticket',
          {},
          err,
        ),
      );
    });
    req.on('close', () => clearTimeout(timeout));

    const fileStream = fs.createReadStream(payloadPath);
    fileStream.pipe(req);
    fileStream.on('error', (err) => {
      req.destroy();
      reject(new AppError('COMMAND_FAILED', 'Failed to read local artifact', {}, err));
    });
  });
}

async function finalizeDirectUpload(options: {
  normalizedBase: string;
  token: string;
  uploadId: string;
}): Promise<string> {
  const finalizeUrl = new URL('upload/finalize', options.normalizedBase);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
    headers['x-agent-device-token'] = options.token;
  }

  const response = await fetch(finalizeUrl, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(UPLOAD_PREFLIGHT_TIMEOUT_MS),
    body: JSON.stringify({ uploadId: options.uploadId }),
  }).catch((error) => {
    throw new AppError('COMMAND_FAILED', 'Failed to finalize direct artifact upload', {}, error);
  });

  if (!response.ok) {
    throw new AppError('COMMAND_FAILED', 'Direct artifact upload finalize failed', {
      status: response.status,
      statusText: response.statusText,
    });
  }

  const parsed = (await response.json().catch(() => undefined)) as UploadResponse | undefined;
  if (!parsed?.ok || !parsed.uploadId) {
    throw new AppError('COMMAND_FAILED', 'Invalid upload finalize response');
  }
  return parsed.uploadId;
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
