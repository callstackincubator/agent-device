import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { AppError } from './utils/errors.ts';

const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

type UploadArtifactOptions = {
  localPath: string;
  baseUrl: string;
  token: string;
};

type UploadResponse = {
  ok: boolean;
  uploadId: string;
};

export async function uploadArtifact(options: UploadArtifactOptions): Promise<string> {
  const { localPath, baseUrl, token } = options;

  const stat = fs.statSync(localPath);
  const isDirectory = stat.isDirectory();
  const filename = path.basename(localPath);
  const artifactType = isDirectory ? 'app-bundle' : 'file';

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const uploadUrl = new URL('upload', normalizedBase);
  const transport = uploadUrl.protocol === 'https:' ? https : http;

  const headers: Record<string, string> = {
    'x-artifact-type': artifactType,
    'x-artifact-filename': filename,
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
