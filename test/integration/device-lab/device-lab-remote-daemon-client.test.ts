import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { createAgentDeviceClient } from '../../../src/client.ts';
import { normalizeAgentDeviceError } from '../../../src/utils/errors.ts';
import {
  closeHttpServer,
  listenHttpOnLoopback,
  requiresLoopbackCoverage,
  supportsLoopbackBind,
} from './loopback.ts';

test('Device Lab remote daemon client materializes artifacts and normalizes RPC errors', async (t) => {
  if (!(await supportsLoopbackBind())) {
    if (requiresLoopbackCoverage()) {
      assert.fail('loopback listeners are required for remote daemon client integration coverage');
    }
    t.skip('loopback listeners are not permitted in this environment');
    return;
  }

  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-remote-client-'));
  const screenshotPath = path.join(stateDir, 'remote-shot.png');
  const recordingPath = path.join(stateDir, 'remote-recording.mp4');
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  const recordingBytes = Buffer.from('remote-recording-bytes');
  const localApkPath = path.join(stateDir, 'demo.apk');
  const localInstallSourcePath = path.join(stateDir, 'source.apk');
  fs.writeFileSync(localApkPath, 'fake-apk');
  fs.writeFileSync(localInstallSourcePath, 'fake-source-apk');
  const rpcRequests: any[] = [];
  const uploadRequests: Array<{
    headers: http.IncomingHttpHeaders;
    body: Buffer;
  }> = [];
  let rpcMode: 'success' | 'error' = 'success';

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url ?? '').startsWith('/health')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }

    if (req.method === 'GET' && (req.url ?? '').startsWith('/artifacts/shot-1')) {
      assert.equal(req.headers.authorization, 'Bearer remote-token');
      assert.equal(req.headers['x-agent-device-token'], 'remote-token');
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(pngBytes);
      return;
    }

    if (req.method === 'GET' && (req.url ?? '').startsWith('/artifacts/recording-1')) {
      assert.equal(req.headers.authorization, 'Bearer remote-token');
      assert.equal(req.headers['x-agent-device-token'], 'remote-token');
      res.writeHead(200, { 'content-type': 'video/mp4' });
      res.end(recordingBytes);
      return;
    }

    if (req.method === 'POST' && req.url === '/upload') {
      assert.equal(req.headers.authorization, 'Bearer remote-token');
      assert.equal(req.headers['x-agent-device-token'], 'remote-token');
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
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, uploadId: `upload-${fileName}` }));
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/rpc') {
      assert.equal(req.headers.authorization, 'Bearer remote-token');
      assert.equal(req.headers['x-agent-device-token'], 'remote-token');
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const payload = JSON.parse(body);
        rpcRequests.push(payload);
        if (rpcMode === 'error') {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
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
            }),
          );
          return;
        }
        if (payload.params?.command === 'install') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: payload.id,
              result: {
                ok: true,
                data: {
                  app: payload.params.positionals[0],
                  appPath: payload.params.positionals[1],
                  platform: 'android',
                  package: 'com.example.demo',
                },
              },
            }),
          );
          return;
        }
        if (payload.params?.command === 'install_source') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: payload.id,
              result: {
                ok: true,
                data: {
                  appName: 'Demo',
                  packageName: 'com.example.demo',
                  launchTarget: 'com.example.demo',
                  installablePath: payload.params.meta.installSource.path,
                },
              },
            }),
          );
          return;
        }
        if (payload.params?.command === 'record') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: payload.id,
              result: {
                ok: true,
                data: {
                  recording: 'started',
                  outPath: payload.params.positionals[1],
                  artifacts: [
                    {
                      artifactId: 'recording-1',
                      field: 'outPath',
                      fileName: 'remote-recording.mp4',
                    },
                  ],
                },
              },
            }),
          );
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
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
          }),
        );
      });
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  try {
    const port = await listenHttpOnLoopback(server);

    const client = createAgentDeviceClient({
      daemonBaseUrl: `http://127.0.0.1:${port}`,
      daemonAuthToken: 'remote-token',
      stateDir,
    });

    const screenshot = await client.capture.screenshot({ path: screenshotPath });
    assert.equal(screenshot.path, screenshotPath);
    assert.deepEqual(fs.readFileSync(screenshotPath), pngBytes);

    const screenshotRpc = rpcRequests.at(-1);
    assert.equal(screenshotRpc?.method, 'agent_device.command');
    assert.equal(screenshotRpc?.params?.command, 'screenshot');
    assert.match(screenshotRpc?.params?.positionals?.[0] ?? '', /^\/tmp\/agent-device-screenshot-/);
    assert.equal(screenshotRpc?.params?.meta?.clientArtifactPaths?.path, screenshotPath);

    const install = await client.apps.install({
      app: 'Demo',
      appPath: localApkPath,
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
    assert.equal(installRpc?.params?.positionals?.[1], localApkPath);
    assert.equal(installRpc?.params?.meta?.uploadedArtifactId, 'upload-demo.apk');

    const installSource = await client.apps.installFromSource({
      source: { kind: 'path', path: localInstallSourcePath },
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
      path: localInstallSourcePath,
    });
    assert.equal(installSourceRpc?.params?.meta?.uploadedArtifactId, 'upload-source.apk');

    const recording = await client.recording.record({
      action: 'start',
      path: recordingPath,
    });
    assert.equal(recording.outPath, recordingPath);
    assert.deepEqual(fs.readFileSync(recordingPath), recordingBytes);

    const recordingRpc = rpcRequests.at(-1);
    assert.equal(recordingRpc?.params?.command, 'record');
    assert.equal(recordingRpc?.params?.positionals?.[0], 'start');
    assert.match(recordingRpc?.params?.positionals?.[1] ?? '', /^\/tmp\/agent-device-recording-/);
    assert.equal(recordingRpc?.params?.meta?.clientArtifactPaths?.outPath, recordingPath);

    rpcMode = 'error';
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
  } finally {
    await closeHttpServer(server);
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
