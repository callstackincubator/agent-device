import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { createAgentDeviceClient } from '../../../src/client.ts';
import { normalizeAgentDeviceError } from '../../../src/utils/errors.ts';
import {
  closeLoopbackServer,
  listenOnLoopback,
  skipWhenLoopbackUnavailable,
} from '../../../src/__tests__/test-utils/loopback.ts';

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

type RemoteDaemonState = {
  artifactMode: 'success' | 'not-found';
  rpcMode: 'success' | 'error';
  rpcRequests: RemoteRpcRequest[];
  uploadRequests: UploadRequest[];
  recordingClientOutPath?: string;
  screenshotPath: string;
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
  rejectArtifactDownloads(): void;
  rejectRpcRequests(): void;
} {
  const state: RemoteDaemonState = {
    artifactMode: 'success',
    rpcMode: 'success',
    rpcRequests: [],
    uploadRequests: [],
    screenshotPath: paths.screenshotPath,
  };
  const server = http.createServer((req, res) => {
    handleRemoteDaemonRequest(req, res, state);
  });

  return {
    server,
    rpcRequests: state.rpcRequests,
    uploadRequests: state.uploadRequests,
    rejectArtifactDownloads() {
      state.artifactMode = 'not-found';
    },
    rejectRpcRequests() {
      state.rpcMode = 'error';
    },
  };
}

function handleRemoteDaemonRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  state: RemoteDaemonState,
): void {
  const route = remoteRoute(req);
  if (route === 'health') return writeHealth(res);
  if (route === 'screenshot-artifact' || route === 'recording-artifact') {
    return writeArtifactResponse(req, res, state, route);
  }
  if (route === 'upload') return handleUpload(req, res, state.uploadRequests);
  if (route === 'rpc') return handleRpc(req, res, state);
  res.writeHead(404);
  res.end('not found');
}

function writeArtifactResponse(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  state: RemoteDaemonState,
  route: 'screenshot-artifact' | 'recording-artifact',
): void {
  if (state.artifactMode === 'not-found') {
    assertRemoteAuth(req);
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('artifact expired');
    return;
  }
  if (route === 'screenshot-artifact') return writeArtifact(req, res, 'image/png', PNG_BYTES);
  if (route === 'recording-artifact') {
    return writeArtifact(req, res, 'video/mp4', RECORDING_BYTES);
  }
}

function remoteRoute(
  req: http.IncomingMessage,
): 'health' | 'screenshot-artifact' | 'recording-artifact' | 'upload' | 'rpc' | undefined {
  const method = req.method;
  const url = req.url ?? '';
  if (method === 'GET' && url.startsWith('/health')) return 'health';
  if (method === 'GET' && url.startsWith('/artifacts/shot-1')) return 'screenshot-artifact';
  if (method === 'GET' && url.startsWith('/artifacts/recording-1')) {
    return 'recording-artifact';
  }
  if (method === 'POST' && url === '/upload') return 'upload';
  if (method === 'POST' && url === '/rpc') return 'rpc';
  return undefined;
}

function writeHealth(res: http.ServerResponse): void {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"ok":true}');
}

function writeArtifact(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  contentType: string,
  body: Buffer,
): void {
  assertRemoteAuth(req);
  res.writeHead(200, { 'content-type': contentType });
  res.end(body);
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
  state: RemoteDaemonState,
): void {
  assertRemoteAuth(req);
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    const payload = JSON.parse(body) as RemoteRpcRequest;
    state.rpcRequests.push(payload);
    if (state.rpcMode === 'error') {
      writeRemoteError(res, payload);
      return;
    }
    writeRemoteSuccess(res, payload, state);
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
  state: RemoteDaemonState,
): void {
  if (payload.params?.command === 'install') return writeInstallSuccess(res, payload);
  if (payload.params?.command === 'install_source') return writeInstallSourceSuccess(res, payload);
  if (payload.params?.command === 'record') return writeRecordSuccess(res, payload, state);
  writeScreenshotSuccess(res, payload, state.screenshotPath);
}

function writeInstallSuccess(res: http.ServerResponse, payload: RemoteRpcRequest): void {
  writeJson(res, 200, {
    jsonrpc: '2.0',
    id: payload.id,
    result: {
      ok: true,
      data: {
        app: payload.params?.positionals?.[0],
        appPath: payload.params?.positionals?.[1],
        platform: 'android',
        package: 'com.example.demo',
      },
    },
  });
}

function writeInstallSourceSuccess(res: http.ServerResponse, payload: RemoteRpcRequest): void {
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
}

function writeRecordSuccess(
  res: http.ServerResponse,
  payload: RemoteRpcRequest,
  state: RemoteDaemonState,
): void {
  const action = String(payload.params?.positionals?.[0] ?? '').toLowerCase();
  if (action === 'start') {
    state.recordingClientOutPath = payload.params?.meta?.clientArtifactPaths?.outPath;
    writeJson(res, 200, {
      jsonrpc: '2.0',
      id: payload.id,
      result: {
        ok: true,
        data: {
          recording: 'started',
          outPath: payload.params?.positionals?.[1],
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
        recording: 'stopped',
        outPath: state.recordingClientOutPath,
        artifacts: [
          {
            artifactId: 'recording-1',
            field: 'outPath',
            localPath: state.recordingClientOutPath,
            fileName: 'remote-recording.mp4',
          },
        ],
      },
    },
  });
}

function writeScreenshotSuccess(
  res: http.ServerResponse,
  payload: RemoteRpcRequest,
  screenshotPath: string,
): void {
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
  const start = await client.recording.record({
    action: 'start',
    path: paths.recordingPath,
  });
  assert.equal(start.recording, 'started');
  assert.equal(fs.existsSync(paths.recordingPath), false);

  const stop = await client.recording.record({ action: 'stop' });
  assert.equal(stop.recording, 'stopped');
  assert.equal(stop.outPath, paths.recordingPath);
  assert.deepEqual(fs.readFileSync(paths.recordingPath), RECORDING_BYTES);

  const recordStartRpc = rpcRequests.at(-2);
  assert.equal(recordStartRpc?.params?.command, 'record');
  assert.equal(recordStartRpc?.params?.positionals?.[0], 'start');
  assert.match(
    String(recordStartRpc?.params?.positionals?.[1] ?? ''),
    /^\/tmp\/agent-device-recording-/,
  );
  assert.equal(recordStartRpc?.params?.meta?.clientArtifactPaths?.outPath, paths.recordingPath);

  const recordStopRpc = rpcRequests.at(-1);
  assert.equal(recordStopRpc?.params?.command, 'record');
  assert.equal(recordStopRpc?.params?.positionals?.[0], 'stop');
  assert.equal(recordStopRpc?.params?.meta?.clientArtifactPaths, undefined);
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

test('Provider-backed integration remote daemon client materializes artifacts and normalizes RPC errors', async (t) => {
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
    const port = await listenOnLoopback(server);

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
    await closeLoopbackServer(server);
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('Provider-backed integration remote daemon client normalizes artifact download failures after successful RPC', async (t) => {
  if (await skipWhenLoopbackUnavailable(t, 'remote daemon artifact failure coverage')) {
    return;
  }

  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-remote-artifact-fail-'));
  const screenshotPath = path.join(stateDir, 'remote-shot.png');
  const { server, rejectArtifactDownloads } = createRemoteDaemonServer({ screenshotPath });

  try {
    const port = await listenOnLoopback(server);
    const client = createAgentDeviceClient({
      daemonBaseUrl: `http://127.0.0.1:${port}`,
      daemonAuthToken: 'remote-token',
      stateDir,
    });
    rejectArtifactDownloads();

    await assert.rejects(
      async () => await client.capture.screenshot({ path: screenshotPath }),
      (error) => {
        const normalized = normalizeAgentDeviceError(error);
        assert.equal(normalized.code, 'COMMAND_FAILED');
        assert.equal(normalized.message, 'Failed to download remote artifact');
        assert.equal(normalized.details?.artifactId, 'shot-1');
        assert.equal(normalized.details?.statusCode, 404);
        assert.equal(normalized.details?.body, 'artifact expired');
        assert.equal(fs.existsSync(screenshotPath), false);
        return true;
      },
    );
  } finally {
    await closeLoopbackServer(server);
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
