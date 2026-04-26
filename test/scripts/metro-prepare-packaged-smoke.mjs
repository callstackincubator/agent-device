import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function runChecked(command, args, cwd, stdio = 'pipe') {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
    stdio,
  });
  if (result.error) {
    throw result.error;
  }
  assert.equal(
    result.status,
    0,
    `Expected ${command} ${args.join(' ')} to succeed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result.stdout;
}

function findPackedTarball(packRoot) {
  const tarballName = fs.readdirSync(packRoot).find((entry) => entry.endsWith('.tgz'));
  assert.ok(tarballName, 'expected pnpm pack to produce a tarball');
  return path.join(packRoot, tarballName);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopProcessIfAlive(pid) {
  if (!isProcessAlive(pid)) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    return;
  }
}

async function supportsLoopbackBind() {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(0, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP server address');
  }
  return address.port;
}

function closeServer(server) {
  if (!server.listening) return;
  server.closeAllConnections();
  server.closeIdleConnections();
  try {
    server.close();
  } catch {
    // best effort cleanup
  }
}

function readJsonBody(req, callback) {
  const chunks = [];
  req.on('data', (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  req.on('end', () => {
    try {
      const body = Buffer.concat(chunks).toString('utf8');
      callback(null, body ? JSON.parse(body) : {});
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  });
  req.on('error', (error) => {
    callback(error instanceof Error ? error : new Error(String(error)));
  });
}

function acceptWebSocket(socket, key) {
  const accept = crypto
    .createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n',
    ].join('\r\n'),
  );
}

async function runCliWithHeartbeat(command, args, cwd) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error(
          `Timed out waiting for packaged metro prepare.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    }, 30_000);
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        status: code,
        stdout,
        stderr,
      });
    });
  });
}

async function main() {
  if (!(await supportsLoopbackBind())) {
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-packaged-metro-'));
  const projectRoot = path.join(root, 'project');
  const configDir = path.join(root, 'config');
  const packRoot = path.join(root, 'pack');
  const installRoot = path.join(root, 'install');
  const bridgeScope = {
    tenant: 'tenant-1',
    runId: 'run-1',
    leaseId: 'lease-1',
  };
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(packRoot, { recursive: true });
  fs.mkdirSync(installRoot, { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'node_modules'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({
      name: 'packaged-metro-smoke',
      version: '1.0.0',
      dependencies: {
        'react-native': '0.79.0',
      },
    }),
    'utf8',
  );

  let companionPid = 0;
  const wsSockets = new Set();
  let registerCalls = 0;
  let bridgeCalls = 0;
  let bridgeSucceeded = false;
  let registerBody;
  const bridgeBodies = [];
  let hostPort = 0;

  const metroServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, {
        'content-type': 'text/plain',
        connection: 'close',
      });
      res.end('packager-status:running');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const metroPort = await listen(metroServer);

  const hostServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/metro/companion/register') {
      readJsonBody(req, (error, body) => {
        if (error) {
          res.writeHead(500, {
            'content-type': 'application/json',
            connection: 'close',
          });
          res.end(JSON.stringify({ error: error.message }));
          return;
        }
        registerCalls += 1;
        registerBody = body;
        res.writeHead(200, {
          'content-type': 'application/json',
          connection: 'close',
        });
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              ws_url: `ws://127.0.0.1:${hostPort}/companion`,
            },
          }),
        );
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/metro/bridge') {
      readJsonBody(req, (error, body) => {
        if (error) {
          res.writeHead(500, {
            'content-type': 'application/json',
            connection: 'close',
          });
          res.end(JSON.stringify({ error: error.message }));
          return;
        }
        bridgeCalls += 1;
        bridgeBodies.push(body);
        if (registerCalls === 0) {
          res.writeHead(503, {
            'content-type': 'application/json',
            connection: 'close',
          });
          res.end(JSON.stringify({ error: 'Metro companion is not connected' }));
          return;
        }
        bridgeSucceeded = true;
        res.writeHead(200, {
          'content-type': 'application/json',
          connection: 'close',
        });
        res.end(
          JSON.stringify({
            data: {
              enabled: true,
              base_url: `http://127.0.0.1:${hostPort}`,
              status_url: `http://127.0.0.1:${metroPort}/status`,
              bundle_url: 'https://packaged.metro.agent-device.dev/index.bundle?platform=ios',
              ios_runtime: {
                metro_host: 'packaged.metro.agent-device.dev',
                metro_port: 443,
                metro_bundle_url:
                  'https://packaged.metro.agent-device.dev/index.bundle?platform=ios',
              },
              android_runtime: {
                metro_host: 'bridge.example.test',
                metro_port: 443,
                metro_bundle_url:
                  'https://bridge.example.test/api/metro/runtimes/packaged/index.bundle?platform=android',
              },
              upstream: {
                bundle_url:
                  'https://public.example.test/index.bundle?platform=ios&dev=true&minify=false',
                host: '127.0.0.1',
                port: metroPort,
                status_url: `http://127.0.0.1:${metroPort}/status`,
              },
              probe: {
                reachable: true,
                status_code: 200,
                latency_ms: 1,
                detail: 'ok',
              },
            },
          }),
        );
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });
  hostServer.on('upgrade', (req, socket) => {
    if (req.url !== '/companion') {
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.destroy();
      return;
    }
    acceptWebSocket(socket, key);
    wsSockets.add(socket);
    socket.on('close', () => {
      wsSockets.delete(socket);
    });
    socket.on('error', () => {
      wsSockets.delete(socket);
    });
  });
  hostPort = await listen(hostServer);

  try {
    const remoteConfigPath = path.join(configDir, 'remote.json');
    fs.writeFileSync(
      remoteConfigPath,
      JSON.stringify({
        metroProjectRoot: projectRoot,
        metroProxyBaseUrl: `http://127.0.0.1:${hostPort}`,
        metroBearerToken: 'shared-token',
        ...bridgeScope,
        metroPreparePort: metroPort,
        metroStartupTimeoutMs: 30_000,
        metroProbeTimeoutMs: 1_000,
      }),
      'utf8',
    );

    runChecked('pnpm', ['build'], REPO_ROOT, 'inherit');
    runChecked(
      'npm',
      ['pack', '--ignore-scripts', '--pack-destination', packRoot],
      REPO_ROOT,
      'inherit',
    );
    const tarballPath = findPackedTarball(packRoot);
    runChecked(
      'npm',
      ['install', '--ignore-scripts', '--prefix', installRoot, tarballPath],
      REPO_ROOT,
      'inherit',
    );
    const cliPath = path.join(
      installRoot,
      'node_modules',
      'agent-device',
      'bin',
      'agent-device.mjs',
    );
    const companionEntryPath = path.join(
      installRoot,
      'node_modules',
      'agent-device',
      'dist',
      'src',
      'internal',
      'companion-tunnel.js',
    );
    const topLevelCompanionEntryPath = path.join(
      installRoot,
      'node_modules',
      'agent-device',
      'dist',
      'src',
      'companion-tunnel.js',
    );
    const updateCheckEntryPath = path.join(
      installRoot,
      'node_modules',
      'agent-device',
      'dist',
      'src',
      'internal',
      'update-check-entry.js',
    );
    assert.equal(
      fs.existsSync(companionEntryPath),
      true,
      'expected packaged companion tunnel entry',
    );
    assert.equal(
      fs.existsSync(topLevelCompanionEntryPath),
      false,
      'unexpected top-level companion tunnel entry',
    );
    assert.equal(fs.existsSync(updateCheckEntryPath), true, 'expected packaged update-check entry');

    const cliResult = await runCliWithHeartbeat(
      process.execPath,
      [cliPath, 'metro', 'prepare', '--remote-config', remoteConfigPath, '--json'],
      projectRoot,
    );

    assert.equal(
      cliResult.status,
      0,
      `packaged CLI failed.\nstdout:\n${cliResult.stdout}\nstderr:\n${cliResult.stderr}`,
    );
    const payload = JSON.parse(cliResult.stdout);
    assert.equal(payload.success, true);
    assert.equal(payload.data.bridge.enabled, true);
    assert.equal(payload.data.bridge.probe.reachable, true);

    const statePath = path.join(projectRoot, '.agent-device', 'metro-companion.json');
    assert.equal(fs.existsSync(statePath), true, 'expected companion state file');
    const companionState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    companionPid = companionState.pid;

    assert.ok(companionPid > 0, 'expected companion pid to be recorded');
    assert.equal(isProcessAlive(companionPid), true, 'expected companion process to be alive');
    assert.equal(registerCalls > 0, true, 'expected companion registration request');
    assert.equal(bridgeCalls >= 2, true, 'expected bridge retry before success');
    assert.equal(bridgeSucceeded, true, 'expected bridge success after registration');
    assert.equal(registerBody.tenantId, bridgeScope.tenant);
    assert.equal(registerBody.runId, bridgeScope.runId);
    assert.equal(registerBody.leaseId, bridgeScope.leaseId);
    assert.equal(registerBody.local_base_url, `http://127.0.0.1:${metroPort}`);
    assert.equal(bridgeBodies[0]?.tenantId, bridgeScope.tenant);
    assert.equal(bridgeBodies[0]?.runId, bridgeScope.runId);
    assert.equal(bridgeBodies[0]?.leaseId, bridgeScope.leaseId);
    assert.equal(bridgeBodies[0]?.ios_runtime, undefined);
    assert.equal(bridgeBodies.at(-1)?.tenantId, bridgeScope.tenant);
    assert.equal(bridgeBodies.at(-1)?.runId, bridgeScope.runId);
    assert.equal(bridgeBodies.at(-1)?.leaseId, bridgeScope.leaseId);
    assert.equal(bridgeBodies.at(-1)?.ios_runtime, undefined);
  } finally {
    stopProcessIfAlive(companionPid);
    for (const socket of wsSockets) {
      socket.destroy();
    }
    closeServer(hostServer);
    closeServer(metroServer);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
