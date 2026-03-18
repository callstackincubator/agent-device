import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { prepareMetroRuntime } from '../client-metro.ts';
import { AppError } from '../utils/errors.ts';

const TEST_TOKEN = 'agent-device-proxy-test-token';

test('prepareMetroRuntime starts Metro, bridges through proxy, and writes runtime file when requested', async () => {
  const tempRoot = path.join(os.tmpdir(), `agent-device-metro-${randomUUID()}`);
  const projectRoot = path.join(tempRoot, 'project');
  const binDir = path.join(tempRoot, 'bin');
  const runtimeFilePath = path.join(projectRoot, '.forfiter', 'metro-runtime.json');
  const metroPort = await findFreePort();
  const proxyPort = await findFreePort();
  const requests: string[] = [];
  const proxySockets = new Set<Socket>();

  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({
      name: 'metro-runtime-test',
      private: true,
      dependencies: {
        'react-native': '0.0.0-test',
      },
    }),
  );
  writeFakeNpx(binDir);

  const proxyServer = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${TEST_TOKEN}`) {
      res.statusCode = 401;
      res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
      return;
    }

    requests.push(req.url || '');
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      ios_runtime?: { metro_bundle_url?: string };
    };
    assert.match(body.ios_runtime?.metro_bundle_url ?? '', /index\.bundle\?platform=ios/);

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/metro/bridge') {
      res.end(
        JSON.stringify({
          ok: true,
          data: {
            enabled: true,
            base_url: 'http://127.0.0.1:8081',
            status_url: 'http://127.0.0.1:8081/status',
            bundle_url: 'http://127.0.0.1:8081/index.bundle?platform=ios&dev=true&minify=false',
            ios_runtime: {
              metro_host: '127.0.0.1',
              metro_port: 8081,
              metro_bundle_url:
                'http://127.0.0.1:8081/index.bundle?platform=ios&dev=true&minify=false',
            },
            android_runtime: {
              metro_host: '10.0.2.2',
              metro_port: 8081,
              metro_bundle_url:
                'http://10.0.2.2:8081/index.bundle?platform=android&dev=true&minify=false',
            },
            upstream: {
              bundle_url: `http://127.0.0.1:${metroPort}/index.bundle?platform=ios&dev=true&minify=false`,
              host: '127.0.0.1',
              port: metroPort,
              status_url: `http://127.0.0.1:${metroPort}/status`,
            },
            probe: {
              reachable: true,
              status_code: 200,
              latency_ms: 3,
              detail: 'ok',
            },
          },
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });
  proxyServer.on('connection', (socket) => {
    proxySockets.add(socket);
    socket.on('close', () => proxySockets.delete(socket));
  });
  proxyServer.listen(proxyPort, '127.0.0.1');
  proxyServer.unref();
  await once(proxyServer, 'listening');

  let pid = 0;

  try {
    const result = await prepareMetroRuntime({
      projectRoot,
      publicBaseUrl: `http://127.0.0.1:${metroPort}`,
      proxyBaseUrl: `http://127.0.0.1:${proxyPort}`,
      proxyBearerToken: TEST_TOKEN,
      metroPort,
      reuseExisting: false,
      installDependenciesIfNeeded: false,
      runtimeFilePath,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH || ''}`,
      },
    });

    pid = result.pid;
    assert.equal(result.kind, 'react-native');
    assert.equal(result.started, true);
    assert.equal(result.reused, false);
    assert.equal(result.bridge?.enabled, true);
    assert.equal(result.iosRuntime.metroHost, '127.0.0.1');
    assert.equal(result.iosRuntime.platform, 'ios');
    assert.equal(result.androidRuntime.metroHost, '10.0.2.2');
    assert.equal(result.androidRuntime.platform, 'android');
    assert.deepEqual(requests, ['/api/metro/bridge']);

    const written = JSON.parse(readFileSync(runtimeFilePath, 'utf8')) as {
      iosRuntime: { metroHost?: string; metroPort?: number; platform?: string };
      androidRuntime: { metroHost?: string; metroPort?: number; platform?: string };
      runtimeFilePath?: string;
    };
    assert.equal(written.iosRuntime.metroHost, '127.0.0.1');
    assert.equal(written.iosRuntime.metroPort, 8081);
    assert.equal(written.iosRuntime.platform, 'ios');
    assert.equal(written.androidRuntime.metroHost, '10.0.2.2');
    assert.equal(written.androidRuntime.platform, 'android');
    assert.equal(written.runtimeFilePath, runtimeFilePath);
  } finally {
    for (const socket of proxySockets) {
      socket.destroy();
    }
    await closeServer(proxyServer);
    if (pid) {
      try {
        process.kill(pid);
      } catch {}
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('prepareMetroRuntime rejects incomplete proxy configuration', async () => {
  await assert.rejects(
    () =>
      prepareMetroRuntime({
        publicBaseUrl: 'https://sandbox.example.test',
        proxyBaseUrl: 'https://proxy.example.test',
      }),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      error.message.includes('--bearer-token'),
  );
});

function writeFakeNpx(binDir: string): void {
  const filePath = path.join(binDir, 'npx');
  writeFileSync(
    filePath,
    `#!/usr/bin/env node
const http = require("node:http")
const args = process.argv.slice(2)
const portIndex = args.indexOf("--port")
const hostIndex = args.indexOf("--host")
const port = portIndex === -1 ? 8081 : Number(args[portIndex + 1] || "8081")
const host = hostIndex === -1 ? "0.0.0.0" : String(args[hostIndex + 1] || "0.0.0.0")
const server = http.createServer((req, res) => {
  if (req.url === "/status") {
    res.statusCode = 200
    res.end("packager-status:running")
    return
  }
  if (req.url && req.url.startsWith("/index.bundle")) {
    res.statusCode = 200
    res.setHeader("content-type", "application/javascript")
    res.end("console.log('metro-runtime-test')")
    return
  }
  res.statusCode = 404
  res.end("not found")
})
server.listen(port, host)
setInterval(() => {}, 1000)
`,
  );
  chmodSync(filePath, 0o755);
}

async function findFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate free port'));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
