import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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
  platform?: string;
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

type UploadPreflightResponse = {
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
      try {
        await uploadDirectArtifact(prepared.payloadPath, preflight);
        return await finalizeDirectUpload({
          normalizedBase,
          token: options.token,
          uploadId: preflight.uploadId,
        });
      } catch {
        return await uploadLegacyArtifact({
          normalizedBase,
          token: options.token,
          artifact: prepared,
        });
      }
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
  requestedPlatform: string | undefined,
): Promise<PreparedUploadArtifact> {
  const stat = fs.statSync(localPath);
  const fileName = path.basename(localPath);
  const isDirectory = stat.isDirectory();
  const platform =
    normalizeUploadPlatform(requestedPlatform) ?? inferArtifactPlatform(localPath, stat);
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
  await runCmd(
    'tar',
    ['czf', archivePath, '-C', path.dirname(localPath), path.basename(localPath)],
    {
      env: {
        ...process.env,
        COPYFILE_DISABLE: '1',
      },
    },
  );
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

function normalizeUploadPlatform(value: string | undefined): 'ios' | 'android' | undefined {
  return value === 'ios' || value === 'android' ? value : undefined;
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

  const response = await streamFileToHttpRequest({
    url: uploadUrl,
    method: 'POST',
    headers,
    payloadPath: artifact.payloadPath,
    timeoutMessage: 'Artifact upload timed out',
    timeoutHint: 'The upload to the remote daemon exceeded the 5-minute timeout.',
    errorMessage: 'Failed to upload artifact to remote daemon',
    errorHint: 'Verify the remote daemon is reachable and supports artifact uploads.',
  });

  try {
    const parsed = JSON.parse(response.body) as UploadResponse;
    if (!parsed.ok || !parsed.uploadId) {
      throw new AppError('COMMAND_FAILED', `Upload failed: ${response.body}`);
    }
    return parsed.uploadId;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('COMMAND_FAILED', `Invalid upload response: ${response.body}`);
  }
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

  return parseUploadPreflightResult(await response.json().catch(() => undefined));
}

function parseUploadPreflightResult(value: unknown): UploadPreflightResult | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const preflight = value as UploadPreflightResponse;
  if (preflight.ok !== true || typeof preflight.uploadId !== 'string') {
    return undefined;
  }
  if (preflight.cacheHit === true) {
    return {
      kind: 'cache-hit',
      uploadId: preflight.uploadId,
    };
  }

  const upload = preflight.upload;
  if (!upload || typeof upload.url !== 'string') {
    return undefined;
  }
  const headers = upload.headers ?? {};
  if (!isStringRecord(headers)) {
    return undefined;
  }
  return {
    kind: 'direct-upload',
    uploadId: preflight.uploadId,
    url: upload.url,
    headers,
  };
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
  const response = await streamFileToHttpRequest({
    url: new URL(ticket.url),
    method: 'PUT',
    headers: ticket.headers,
    payloadPath,
    timeoutMessage: 'Direct artifact upload timed out',
    timeoutHint: 'The direct upload ticket did not accept the artifact within the timeout.',
    errorMessage: 'Failed to upload artifact with direct upload ticket',
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new AppError('COMMAND_FAILED', 'Direct artifact upload failed', {
      statusCode: response.statusCode,
      statusMessage: response.statusMessage,
    });
  }
}

async function streamFileToHttpRequest(options: {
  url: URL;
  method: 'POST' | 'PUT';
  headers: Record<string, string>;
  payloadPath: string;
  timeoutMessage: string;
  timeoutHint?: string;
  errorMessage: string;
  errorHint?: string;
}): Promise<{ statusCode: number; statusMessage?: string; body: string }> {
  const transport = options.url.protocol === 'https:' ? https : http;

  return await new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: options.url.protocol,
        host: options.url.hostname,
        port: options.url.port,
        method: options.method,
        path: options.url.pathname + options.url.search,
        headers: options.headers,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          clearTimeout(timeout);
          resolve({
            statusCode: res.statusCode ?? 500,
            statusMessage: res.statusMessage,
            body,
          });
        });
      },
    );

    const timeout = setTimeout(() => {
      req.destroy();
      reject(
        new AppError('COMMAND_FAILED', options.timeoutMessage, {
          timeoutMs: UPLOAD_TIMEOUT_MS,
          ...(options.timeoutHint ? { hint: options.timeoutHint } : {}),
        }),
      );
    }, UPLOAD_TIMEOUT_MS);

    req.on('error', (err) => {
      clearTimeout(timeout);
      reject(
        new AppError(
          'COMMAND_FAILED',
          options.errorMessage,
          options.errorHint ? { hint: options.errorHint } : {},
          err,
        ),
      );
    });
    req.on('close', () => clearTimeout(timeout));

    void pipeline(fs.createReadStream(options.payloadPath), req).catch((err: unknown) => {
      req.destroy();
      const error = err instanceof Error ? err : new Error(String(err));
      reject(new AppError('COMMAND_FAILED', 'Failed to read local artifact', {}, error));
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
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback();
    },
  });
  await pipeline(fs.createReadStream(localPath), sink).catch((err: unknown) => {
    throw new AppError(
      'COMMAND_FAILED',
      'Failed to read local artifact',
      {},
      err instanceof Error ? err : undefined,
    );
  });
  return hash.digest('hex');
}
