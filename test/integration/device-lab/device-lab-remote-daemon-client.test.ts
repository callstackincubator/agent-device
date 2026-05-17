import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { createAgentDeviceClient } from '../../../src/client.ts';
import { normalizeAgentDeviceError } from '../../../src/utils/errors.ts';
import { closeHttpServer, listenHttpOnLoopback, skipWhenLoopbackUnavailable } from './loopback.ts';

type RemoteRpcRequest = {
  id: unknown;
  method?: string;
  params?: {
    command?: string;
    positionals?: unknown[];
    meta?: {
      clientArtifactPaths?: Record<string, string>;
      installSource?: unknown;
      uploadedArtifactId?: string;
    };
  };
};

type UploadRequest = {
  headers: http.IncomingHttpHeaders;
  body: Buffer;
};

type RemoteClient = ReturnType<typeof createAgentDeviceClient>;

type RemotePaths = {
  screenshotPath: string;
  recordingPath: string;
  localApkPath: string;
  localInstallSourcePath: string;
};

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const RECORDING_BYTES = Buffer.from('remote-recording-bytes');

function assertRemoteAuth(req: http.IncomingMessage): void {
  assert.equal(req.headers.authorization, 'Bearer remote-token');
  assert.equal(req.headers['x-agent-device-token'], 'remote-token');
}

function writeJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function createRemoteDaemonServer(paths: { screenshotPath: string }): {
  server: http.Server;
  rpcRequests: RemoteRpcRequest[];
  uploadRequests: UploadRequest[];
  rejectRpcRequests(): void;
} {
  const rpcRequests: RemoteRpcRequest[] = [];
  const uploadRequests: UploadRequest[] = [];
  let rpcMode: 'success' | 'error' = 'success';

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url ?? '').startsWith('/health')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }

    if (req.method === 'GET' && (req.url ?? '').startsWith('/artifacts/shot-1')) {
      assertRemoteAuth(req);
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG_BYTES);
      return;
    }

    if (req.method === 'GET' && (req.url ?? '').startsWith('/artifacts/recording-1')) {
      assertRemoteAuth(req);
      res.writeHead(200, { 'content-type': 'video/mp4' });
      res.end(RECORDING_BYTES);
      return;
    }

    if (req.method === 'POST' && req.url === '/upload') {
      handleUpload(req, res, uploadRequests);
      return;
    }

    if (req.method === 'POST' && req.url === '/rpc') {
      handleRpc(req, res, {
        getRpcMode: () => rpcMode,
        rpcRequests,
        screenshotPath: paths.screenshotPath,
      });
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  return {
    server,
    rpcRequests,
    uploadRequests,
    rejectRpcRequests() {
      rpcMode = 'error';
    },
  };
}

function handleUpload(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  uploadRequests: UploadRequest[],
): void {
  assertRemoteAuth(req);
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });
  req.on('end', () => {
    uploadRequests.push({
      headers: req.headers,
      body: Buffer.concat(chunks),
    });
    const fileName = String(req.headers['x-artifact-filename'] ?? 'artifact');
    writeJson(res, 200, { ok: true, uploadId: `upload-${fileName}` });
  });
}

function handleRpc(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: {
    getRpcMode: () => 'success' | 'error';
    rpcRequests: RemoteRpcRequest[];
    screenshotPath: string;
  },
): void {
  assertRemoteAuth(req);
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    const payload = JSON.parse(body) as RemoteRpcRequest;
    options.rpcRequests.push(payload);
    if (options.getRpcMode() === 'error') {
      writeRemoteError(res, payload);
      return;
    }
    writeRemoteSuccess(res, payload, options.screenshotPath);
  });
}

function writeRemoteError(res: http.ServerResponse, payload: RemoteRpcRequest): void {
  writeJson(res, 400, {
    jsonrpc: '2.0',
    id: payload.id,
    error: {
      code: -32000,
      message: 'remote rejected request',
      data: {
        code: 'INVALID_ARGS',
        message: 'remote invalid args',
        hint: 'remote hint',
        diagnosticId: 'diag-remote',
        logPath: '/remote/log.txt',
        details: { remote: true },
      },
    },
  });
}

function writeRemoteSuccess(
  res: http.ServerResponse,
  payload: RemoteRpcRequest,
  screenshotPath: string,
): void {
  if (payload.params?.command === 'install') {
    writeJson(res, 200, {
      jsonrpc: '2.0',
      id: payload.id,
      result: {
        ok: true,
        data: {
          app: payload.params.positionals?.[0],
          appPath: payload.params.positionals?.[1],
          platform: 'android',
          package: 'com.example.demo',
        },
      },
    });
    return;
  }
  if (payload.params?.command === 'install_source') {
    writeJson(res, 200, {
      jsonrpc: '2.0',
      id: payload.id,
      result: {
        ok: true,
        data: {
          appName: 'Demo',
          packageName: 'com.example.demo',
          launchTarget: 'com.example.demo',
          installablePath: resolveInstallSourcePath(payload),
        },
      },
    });
    return;
  }
  if (payload.params?.command === 'record') {
    writeJson(res, 200, {
      jsonrpc: '2.0',
      id: payload.id,
      result: {
        ok: true,
        data: {
          recording: 'started',
          outPath: payload.params.positionals?.[1],
          artifacts: [
            {
              artifactId: 'recording-1',
              field: 'outPath',
              fileName: 'remote-recording.mp4',
            },
          ],
        },
      },
    });
    return;
  }
  writeJson(res, 200, {
    jsonrpc: '2.0',
    id: payload.id,
    result: {
      ok: true,
      data: {
        path: '/tmp/agent-device-remote-shot.png',
        artifacts: [
          {
            artifactId: 'shot-1',
            field: 'path',
            localPath: screenshotPath,
            fileName: 'remote-shot.png',
          },
        ],
      },
    },
  });
}

function resolveInstallSourcePath(payload: RemoteRpcRequest): string | undefined {
  const source = payload.params?.meta?.installSource;
  if (source && typeof source === 'object' && 'path' in source && typeof source.path === 'string') {
    return source.path;
  }
  return undefined;
}

async function assertScreenshotRoundTrip(
  client: RemoteClient,
  paths: RemotePaths,
  rpcRequests: RemoteRpcRequest[],
): Promise<void> {
  const screenshot = await client.capture.screenshot({ path: paths.screenshotPath });
  assert.equal(screenshot.path, paths.screenshotPath);
  assert.deepEqual(fs.readFileSync(paths.screenshotPath), PNG_BYTES);

  const screenshotRpc = rpcRequests.at(-1);
  assert.equal(screenshotRpc?.method, 'agent_device.command');
  assert.equal(screenshotRpc?.params?.command, 'screenshot');
  assert.match(
    String(screenshotRpc?.params?.positionals?.[0] ?? ''),
    /^\/tmp\/agent-device-screenshot-/,
  );
  assert.equal(screenshotRpc?.params?.meta?.clientArtifactPaths?.path, paths.screenshotPath);
}

async function assertInstallUpload(
  client: RemoteClient,
  paths: RemotePaths,
  rpcRequests: RemoteRpcRequest[],
  uploadRequests: UploadRequest[],
): Promise<void> {
  const install = await client.apps.install({
    app: 'Demo',
    appPath: paths.localApkPath,
    platform: 'android',
  });
  assert.equal(install.package, 'com.example.demo');
  assert.equal(uploadRequests.length, 1);
  assert.equal(uploadRequests[0]?.headers['x-artifact-type'], 'file');
  assert.equal(uploadRequests[0]?.headers['x-artifact-filename'], 'demo.apk');
  assert.equal(uploadRequests[0]?.headers['x-artifact-hash-algorithm'], 'sha256');
  assert.deepEqual(uploadRequests[0]?.body, Buffer.from('fake-apk'));

  const installRpc = rpcRequests.at(-1);
  assert.equal(installRpc?.params?.command, 'install');
  assert.equal(installRpc?.params?.positionals?.[1], paths.localApkPath);
  assert.equal(installRpc?.params?.meta?.uploadedArtifactId, 'upload-demo.apk');
}

async function assertInstallSourceUpload(
  client: RemoteClient,
  paths: RemotePaths,
  rpcRequests: RemoteRpcRequest[],
  uploadRequests: UploadRequest[],
): Promise<void> {
  const installSource = await client.apps.installFromSource({
    source: { kind: 'path', path: paths.localInstallSourcePath },
    platform: 'android',
  });
  assert.equal(installSource.launchTarget, 'com.example.demo');
  assert.equal(uploadRequests.length, 2);
  assert.equal(uploadRequests[1]?.headers['x-artifact-type'], 'file');
  assert.equal(uploadRequests[1]?.headers['x-artifact-filename'], 'source.apk');
  assert.deepEqual(uploadRequests[1]?.body, Buffer.from('fake-source-apk'));

  const installSourceRpc = rpcRequests.at(-1);
  assert.equal(installSourceRpc?.params?.command, 'install_source');
  assert.deepEqual(installSourceRpc?.params?.meta?.installSource, {
    kind: 'path',
    path: paths.localInstallSourcePath,
  });
  assert.equal(installSourceRpc?.params?.meta?.uploadedArtifactId, 'upload-source.apk');
}

async function assertRecordingArtifactRoundTrip(
  client: RemoteClient,
  paths: RemotePaths,
  rpcRequests: RemoteRpcRequest[],
): Promise<void> {
  const recording = await client.recording.record({
    action: 'start',
    path: paths.recordingPath,
  });
  assert.equal(recording.outPath, paths.recordingPath);
  assert.deepEqual(fs.readFileSync(paths.recordingPath), RECORDING_BYTES);

  const recordingRpc = rpcRequests.at(-1);
  assert.equal(recordingRpc?.params?.command, 'record');
  assert.equal(recordingRpc?.params?.positionals?.[0], 'start');
  assert.match(
    String(recordingRpc?.params?.positionals?.[1] ?? ''),
    /^\/tmp\/agent-device-recording-/,
  );
  assert.equal(recordingRpc?.params?.meta?.clientArtifactPaths?.outPath, paths.recordingPath);
}

async function assertRemoteRpcErrorNormalization(client: RemoteClient): Promise<void> {
  await assert.rejects(
    async () => await client.sessions.list(),
    (error) => {
      const normalized = normalizeAgentDeviceError(error);
      assert.equal(normalized.code, 'INVALID_ARGS');
      assert.equal(normalized.message, 'remote invalid args');
      assert.equal(normalized.hint, 'remote hint');
      assert.equal(normalized.diagnosticId, 'diag-remote');
      assert.equal(normalized.logPath, '/remote/log.txt');
      assert.equal(normalized.details?.remote, true);
      assert.equal(typeof normalized.details?.requestId, 'string');
      return true;
    },
  );
}

test('Device Lab remote daemon client materializes artifacts and normalizes RPC errors', async (t) => {
  if (await skipWhenLoopbackUnavailable(t, 'remote daemon client integration coverage')) {
    return;
  }

  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-remote-client-'));
  const screenshotPath = path.join(stateDir, 'remote-shot.png');
  const recordingPath = path.join(stateDir, 'remote-recording.mp4');
  const localApkPath = path.join(stateDir, 'demo.apk');
  const localInstallSourcePath = path.join(stateDir, 'source.apk');
  fs.writeFileSync(localApkPath, 'fake-apk');
  fs.writeFileSync(localInstallSourcePath, 'fake-source-apk');
  const paths = {
    screenshotPath,
    recordingPath,
    localApkPath,
    localInstallSourcePath,
  };

  const { server, rpcRequests, uploadRequests, rejectRpcRequests } = createRemoteDaemonServer({
    screenshotPath,
  });

  try {
    const port = await listenHttpOnLoopback(server);

    const client = createAgentDeviceClient({
      daemonBaseUrl: `http://127.0.0.1:${port}`,
      daemonAuthToken: 'remote-token',
      stateDir,
    });

    await assertScreenshotRoundTrip(client, paths, rpcRequests);
    await assertInstallUpload(client, paths, rpcRequests, uploadRequests);
    await assertInstallSourceUpload(client, paths, rpcRequests, uploadRequests);
    await assertRecordingArtifactRoundTrip(client, paths, rpcRequests);
    rejectRpcRequests();
    await assertRemoteRpcErrorNormalization(client);
  } finally {
    await closeHttpServer(server);
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
