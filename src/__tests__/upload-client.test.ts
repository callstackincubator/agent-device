import { test, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { uploadArtifact } from '../upload-client.ts';

const TEST_TOKEN = 'agent-device-upload-test-token';
const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.length = 0;
});

test('uploadArtifact returns preflight uploadId without uploading bytes on cache hit', async () => {
  const content = 'cached-apk-payload';
  const artifactPath = createTempFile('app.apk', content);
  const expectedHash = sha256(content);
  let uploadCalled = false;

  const server = await startServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/upload/preflight') {
      assert.equal(req.headers.authorization, `Bearer ${TEST_TOKEN}`);
      assert.equal(req.headers['x-agent-device-token'], TEST_TOKEN);
      const body = JSON.parse((await readRequestBody(req)).toString('utf8')) as {
        hash: string;
        hashAlgorithm: string;
        fileName: string;
        sizeBytes: number;
        artifactType: string;
      };
      assert.equal(body.hash, expectedHash);
      assert.equal(body.hashAlgorithm, 'sha256');
      assert.equal(body.fileName, 'app.apk');
      assert.equal(body.sizeBytes, Buffer.byteLength(content));
      assert.equal(body.artifactType, 'file');
      sendJson(res, { ok: true, cacheHit: true, uploadId: 'upload-cached' });
      return;
    }
    if (req.method === 'POST' && req.url === '/upload') {
      uploadCalled = true;
      await readRequestBody(req);
      sendJson(res, { ok: true, uploadId: 'upload-unexpected' });
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });

  try {
    const uploadId = await uploadArtifact({
      localPath: artifactPath,
      baseUrl: server.baseUrl,
      token: TEST_TOKEN,
    });
    assert.equal(uploadId, 'upload-cached');
    assert.equal(uploadCalled, false);
  } finally {
    await server.close();
  }
});

test('uploadArtifact uploads with hash headers after preflight cache miss', async () => {
  const content = 'fresh-apk-payload';
  const artifactPath = createTempFile('app.apk', content);
  const expectedHash = sha256(content);
  const requests: string[] = [];

  const server = await startServer(async (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.method === 'POST' && req.url === '/upload/preflight') {
      const body = JSON.parse((await readRequestBody(req)).toString('utf8')) as {
        hash: string;
      };
      assert.equal(body.hash, expectedHash);
      sendJson(res, { ok: true, cacheHit: false });
      return;
    }
    if (req.method === 'POST' && req.url === '/upload') {
      assert.equal(req.headers['x-artifact-type'], 'file');
      assert.equal(req.headers['x-artifact-filename'], 'app.apk');
      assert.equal(req.headers['x-artifact-hash'], expectedHash);
      assert.equal(req.headers['x-artifact-hash-algorithm'], 'sha256');
      assert.equal((await readRequestBody(req)).toString('utf8'), content);
      sendJson(res, { ok: true, uploadId: 'upload-miss' });
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });

  try {
    const uploadId = await uploadArtifact({
      localPath: artifactPath,
      baseUrl: server.baseUrl,
      token: TEST_TOKEN,
    });
    assert.equal(uploadId, 'upload-miss');
    assert.deepEqual(requests, ['POST /upload/preflight', 'POST /upload']);
  } finally {
    await server.close();
  }
});

test('uploadArtifact falls back to upload when preflight is unsupported', async () => {
  const content = 'legacy-daemon-payload';
  const artifactPath = createTempFile('app.apk', content);
  const expectedHash = sha256(content);
  const requests: string[] = [];

  const server = await startServer(async (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.method === 'POST' && req.url === '/upload/preflight') {
      await readRequestBody(req);
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    if (req.method === 'POST' && req.url === '/upload') {
      assert.equal(req.headers['x-artifact-hash'], expectedHash);
      assert.equal(req.headers['x-artifact-hash-algorithm'], 'sha256');
      assert.equal((await readRequestBody(req)).toString('utf8'), content);
      sendJson(res, { ok: true, uploadId: 'upload-legacy' });
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });

  try {
    const uploadId = await uploadArtifact({
      localPath: artifactPath,
      baseUrl: server.baseUrl,
      token: TEST_TOKEN,
    });
    assert.equal(uploadId, 'upload-legacy');
    assert.deepEqual(requests, ['POST /upload/preflight', 'POST /upload']);
  } finally {
    await server.close();
  }
});

test('uploadArtifact falls back to upload when preflight fails', async () => {
  const content = 'preflight-failure-payload';
  const artifactPath = createTempFile('app.apk', content);
  const expectedHash = sha256(content);
  const requests: string[] = [];

  const server = await startServer(async (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.method === 'POST' && req.url === '/upload/preflight') {
      await readRequestBody(req);
      res.statusCode = 503;
      res.end(JSON.stringify({ ok: false, error: 'cache temporarily unavailable' }));
      return;
    }
    if (req.method === 'POST' && req.url === '/upload') {
      assert.equal(req.headers['x-artifact-hash'], expectedHash);
      assert.equal(req.headers['x-artifact-hash-algorithm'], 'sha256');
      assert.equal((await readRequestBody(req)).toString('utf8'), content);
      sendJson(res, { ok: true, uploadId: 'upload-after-preflight-failure' });
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });

  try {
    const uploadId = await uploadArtifact({
      localPath: artifactPath,
      baseUrl: server.baseUrl,
      token: TEST_TOKEN,
    });
    assert.equal(uploadId, 'upload-after-preflight-failure');
    assert.deepEqual(requests, ['POST /upload/preflight', 'POST /upload']);
  } finally {
    await server.close();
  }
});

test('uploadArtifact skips preflight and hash headers for app bundle directories', async () => {
  const tempRoot = createTempDir();
  const appPath = path.join(tempRoot, 'Sample.app');
  fs.mkdirSync(appPath, { recursive: true });
  fs.writeFileSync(path.join(appPath, 'payload.txt'), 'app-bundle-payload');
  const requests: string[] = [];

  const server = await startServer(async (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.method === 'POST' && req.url === '/upload') {
      assert.equal(req.headers['x-artifact-type'], 'app-bundle');
      assert.equal(req.headers['x-artifact-filename'], 'Sample.app');
      assert.equal(req.headers['x-artifact-hash'], undefined);
      assert.equal(req.headers['x-artifact-hash-algorithm'], undefined);
      const body = await readRequestBody(req);
      assert.ok(body.length > 0);
      sendJson(res, { ok: true, uploadId: 'upload-app-bundle' });
      return;
    }
    res.statusCode = 500;
    res.end('unexpected request');
  });

  try {
    const uploadId = await uploadArtifact({
      localPath: appPath,
      baseUrl: server.baseUrl,
      token: TEST_TOKEN,
    });
    assert.equal(uploadId, 'upload-app-bundle');
    assert.deepEqual(requests, ['POST /upload']);
  } finally {
    await server.close();
  }
});

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `agent-device-upload-client-${randomUUID()}-`));
  tempDirs.push(dir);
  return dir;
}

function createTempFile(filename: string, content: string): string {
  const dir = createTempDir();
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content);
  return filePath;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    void handler(req, res).catch((error) => {
      res.statusCode = 500;
      res.end(error instanceof Error ? error.message : String(error));
    });
  });
  server.listen(0, '127.0.0.1');
  server.unref();
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sendJson(res: ServerResponse, body: unknown): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}
