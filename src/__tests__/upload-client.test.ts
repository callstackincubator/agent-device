import { test, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { uploadArtifact } from '../upload-client.ts';
import { runCmdSync } from '../utils/exec.ts';

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
        sha256: string;
        fileName: string;
        sizeBytes: number;
        artifactType: string;
        platform: string;
        contentType: string;
      };
      assert.equal(body.sha256, expectedHash);
      assert.equal(body.fileName, 'app.apk');
      assert.equal(body.sizeBytes, Buffer.byteLength(content));
      assert.equal(body.artifactType, 'file');
      assert.equal(body.platform, 'android');
      assert.equal(body.contentType, 'application/octet-stream');
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
        sha256: string;
      };
      assert.equal(body.sha256, expectedHash);
      sendJson(res, { ok: true, cacheHit: false });
      return;
    }
    if (req.method === 'POST' && req.url === '/upload') {
      assert.equal(req.headers['x-artifact-type'], 'file');
      assert.equal(req.headers['x-artifact-filename'], 'app.apk');
      assert.equal(req.headers['x-artifact-hash'], expectedHash);
      assert.equal(req.headers['x-artifact-hash-algorithm'], 'sha256');
      assert.equal(req.headers['content-type'], 'application/octet-stream');
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

test('uploadArtifact uses direct upload ticket and finalize flow', async () => {
  const content = 'direct-upload-apk';
  const artifactPath = createTempFile('app.apk', content);
  const expectedHash = sha256(content);
  const requests: string[] = [];
  let directUploadBody = '';

  const server = await startServer(async (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.method === 'POST' && req.url === '/upload/preflight') {
      const body = JSON.parse((await readRequestBody(req)).toString('utf8')) as {
        sha256: string;
        fileName: string;
        artifactType: string;
        platform: string;
        contentType: string;
      };
      assert.equal(body.sha256, expectedHash);
      assert.equal(body.fileName, 'app.apk');
      assert.equal(body.artifactType, 'file');
      assert.equal(body.platform, 'android');
      assert.equal(body.contentType, 'application/octet-stream');
      sendJson(res, {
        ok: true,
        cacheHit: false,
        uploadId: 'direct-ticket',
        upload: {
          url: `${server.baseUrl}/signed-upload`,
          headers: {
            'x-signed-ticket': 'ticket-header',
          },
        },
      });
      return;
    }
    if (req.method === 'PUT' && req.url === '/signed-upload') {
      assert.equal(req.headers.authorization, undefined);
      assert.equal(req.headers['x-agent-device-token'], undefined);
      assert.equal(req.headers['x-signed-ticket'], 'ticket-header');
      directUploadBody = (await readRequestBody(req)).toString('utf8');
      res.statusCode = 200;
      res.end('ok');
      return;
    }
    if (req.method === 'POST' && req.url === '/upload/finalize') {
      assert.equal(req.headers.authorization, `Bearer ${TEST_TOKEN}`);
      const body = JSON.parse((await readRequestBody(req)).toString('utf8')) as {
        uploadId: string;
      };
      assert.equal(body.uploadId, 'direct-ticket');
      sendJson(res, { ok: true, uploadId: 'upload-finalized' });
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
    assert.equal(uploadId, 'upload-finalized');
    assert.equal(directUploadBody, content);
    assert.deepEqual(requests, [
      'POST /upload/preflight',
      'PUT /signed-upload',
      'POST /upload/finalize',
    ]);
  } finally {
    await server.close();
  }
});

test.each([
  {
    name: 'direct upload failure',
    failDirectUpload: true,
    expectedRequests: ['POST /upload/preflight', 'PUT /signed-upload', 'POST /upload'],
  },
  {
    name: 'finalize failure',
    failDirectUpload: false,
    expectedRequests: [
      'POST /upload/preflight',
      'PUT /signed-upload',
      'POST /upload/finalize',
      'POST /upload',
    ],
  },
])(
  'uploadArtifact falls back to legacy upload after $name',
  async ({ failDirectUpload, expectedRequests }) => {
    const content = `${failDirectUpload ? 'direct' : 'finalize'}-fallback-apk`;
    const artifactPath = createTempFile('app.apk', content);
    const requests: string[] = [];
    let legacyUploadBody = '';

    const server = await startServer(async (req, res) => {
      requests.push(`${req.method} ${req.url}`);
      if (req.method === 'POST' && req.url === '/upload/preflight') {
        await readRequestBody(req);
        sendJson(res, {
          ok: true,
          cacheHit: false,
          uploadId: 'direct-ticket',
          upload: {
            url: `${server.baseUrl}/signed-upload`,
            headers: { 'x-signed-ticket': 'ticket-header' },
          },
        });
        return;
      }
      if (req.method === 'PUT' && req.url === '/signed-upload') {
        await readRequestBody(req);
        res.statusCode = failDirectUpload ? 503 : 200;
        res.end(failDirectUpload ? 'storage unavailable' : 'ok');
        return;
      }
      if (req.method === 'POST' && req.url === '/upload/finalize') {
        await readRequestBody(req);
        res.statusCode = 503;
        res.end('finalize unavailable');
        return;
      }
      if (req.method === 'POST' && req.url === '/upload') {
        assert.equal(req.headers['x-artifact-type'], 'file');
        assert.equal(req.headers['x-artifact-filename'], 'app.apk');
        legacyUploadBody = (await readRequestBody(req)).toString('utf8');
        sendJson(res, { ok: true, uploadId: 'legacy-fallback' });
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
      assert.equal(uploadId, 'legacy-fallback');
      assert.equal(legacyUploadBody, content);
      assert.deepEqual(requests, expectedRequests);
    } finally {
      await server.close();
    }
  },
);

test('uploadArtifact preflights and legacy-uploads compressed app bundle directories', async () => {
  const tempRoot = createTempDir();
  const appPath = path.join(tempRoot, 'Sample.app');
  fs.mkdirSync(appPath, { recursive: true });
  fs.writeFileSync(path.join(appPath, 'payload.txt'), 'app-bundle-payload');
  const requests: string[] = [];
  let preflightSha = '';
  let preflightSize = 0;

  const server = await startServer(async (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.method === 'POST' && req.url === '/upload/preflight') {
      const body = JSON.parse((await readRequestBody(req)).toString('utf8')) as {
        sha256: string;
        fileName: string;
        sizeBytes: number;
        artifactType: string;
        platform: string;
        contentType: string;
      };
      preflightSha = body.sha256;
      preflightSize = body.sizeBytes;
      assert.equal(body.fileName, 'Sample.app');
      assert.equal(body.artifactType, 'app-bundle');
      assert.equal(body.platform, 'ios');
      assert.equal(body.contentType, 'application/gzip');
      sendJson(res, { ok: true, cacheHit: false });
      return;
    }
    if (req.method === 'POST' && req.url === '/upload') {
      assert.equal(req.headers['x-artifact-type'], 'app-bundle');
      assert.equal(req.headers['x-artifact-filename'], 'Sample.app');
      assert.equal(req.headers['x-artifact-hash'], preflightSha);
      assert.equal(req.headers['x-artifact-hash-algorithm'], 'sha256');
      assert.equal(req.headers['content-type'], 'application/gzip');
      const body = await readRequestBody(req);
      assert.equal(body.length, preflightSize);
      assert.equal(sha256(body), preflightSha);
      assert.ok(body.length > 0);
      assert.deepEqual(listTarGzipEntries(body), ['Sample.app/', 'Sample.app/payload.txt']);
      sendJson(res, { ok: true, uploadId: 'upload-app-bundle' });
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });

  try {
    const uploadId = await uploadArtifact({
      localPath: appPath,
      baseUrl: server.baseUrl,
      token: TEST_TOKEN,
    });
    assert.equal(uploadId, 'upload-app-bundle');
    assert.deepEqual(requests, ['POST /upload/preflight', 'POST /upload']);
  } finally {
    await server.close();
  }
});

test('uploadArtifact uploads APK, AAB, and IPA files without wrapping them', async () => {
  const cases = [
    { filename: 'app.apk', platform: 'android' },
    { filename: 'app.aab', platform: 'android' },
    { filename: 'App.ipa', platform: 'ios' },
  ] as const;

  for (const testCase of cases) {
    const content = `${testCase.filename}-payload`;
    const artifactPath = createTempFile(testCase.filename, content);
    const requests: string[] = [];

    const server = await startServer(async (req, res) => {
      requests.push(`${req.method} ${req.url}`);
      if (req.method === 'POST' && req.url === '/upload/preflight') {
        const body = JSON.parse((await readRequestBody(req)).toString('utf8')) as {
          fileName: string;
          artifactType: string;
          platform: string;
          contentType: string;
        };
        assert.equal(body.fileName, testCase.filename);
        assert.equal(body.artifactType, 'file');
        assert.equal(body.platform, testCase.platform);
        assert.equal(body.contentType, 'application/octet-stream');
        sendJson(res, { ok: true, cacheHit: false });
        return;
      }
      if (req.method === 'POST' && req.url === '/upload') {
        assert.equal(req.headers['x-artifact-type'], 'file');
        assert.equal(req.headers['x-artifact-filename'], testCase.filename);
        assert.equal((await readRequestBody(req)).toString('utf8'), content);
        sendJson(res, { ok: true, uploadId: `upload-${testCase.platform}` });
        return;
      }
      res.statusCode = 404;
      res.end('not found');
    });

    try {
      await uploadArtifact({
        localPath: artifactPath,
        baseUrl: server.baseUrl,
        token: TEST_TOKEN,
      });
      assert.deepEqual(requests, ['POST /upload/preflight', 'POST /upload']);
    } finally {
      await server.close();
    }
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

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function listTarGzipEntries(archive: Buffer): string[] {
  const dir = createTempDir();
  const archivePath = path.join(dir, 'archive.tar.gz');
  fs.writeFileSync(archivePath, archive);
  const result = runCmdSync('tar', ['-tzf', archivePath]);
  return result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
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
