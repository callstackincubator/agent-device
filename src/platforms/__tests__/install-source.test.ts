import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  isTrustedInstallSourceUrl,
  materializeInstallablePath,
  validateDownloadSourceUrl,
} from '../install-source.ts';
import { prepareAndroidInstallArtifact } from '../android/install-artifact.ts';
import { prepareIosInstallArtifact } from '../ios/install-artifact.ts';

test('validateDownloadSourceUrl rejects localhost and private literal addresses by default', async () => {
  await assert.rejects(
    async () => await validateDownloadSourceUrl(new URL('http://127.0.0.1/app.apk')),
    /not allowed|private or loopback/i,
  );
  await assert.rejects(
    async () => await validateDownloadSourceUrl(new URL('http://localhost/app.apk')),
    /not allowed|private or loopback/i,
  );
  await assert.rejects(
    async () => await validateDownloadSourceUrl(new URL('http://10.0.0.8/app.apk')),
    /not allowed|private or loopback/i,
  );
});

test('validateDownloadSourceUrl allows private URLs when explicitly enabled', async () => {
  const previous = process.env.AGENT_DEVICE_ALLOW_PRIVATE_SOURCE_URLS;
  process.env.AGENT_DEVICE_ALLOW_PRIVATE_SOURCE_URLS = '1';
  try {
    await validateDownloadSourceUrl(new URL('http://127.0.0.1/app.apk'));
  } finally {
    if (previous === undefined) delete process.env.AGENT_DEVICE_ALLOW_PRIVATE_SOURCE_URLS;
    else process.env.AGENT_DEVICE_ALLOW_PRIVATE_SOURCE_URLS = previous;
  }
});

test('validateDownloadSourceUrl rejects unsupported protocols', async () => {
  await assert.rejects(
    async () => await validateDownloadSourceUrl(new URL('ftp://example.com/app.apk')),
    /Unsupported source URL protocol/i,
  );
});

test('isTrustedInstallSourceUrl recognizes supported artifact services', () => {
  assert.equal(
    isTrustedInstallSourceUrl('https://api.github.com/repos/acme/app/actions/artifacts/1/zip'),
    true,
  );
  assert.equal(
    isTrustedInstallSourceUrl('https://github.com/acme/app/actions/runs/123/artifacts/456'),
    true,
  );
  assert.equal(
    isTrustedInstallSourceUrl('https://github.com/acme/app/suites/789/artifacts/456'),
    true,
  );
  assert.equal(
    isTrustedInstallSourceUrl('https://expo.dev/accounts/acme/projects/app/builds/123'),
    true,
  );
  assert.equal(
    isTrustedInstallSourceUrl('https://download.expo.dev/artifacts/eas/build-123/app.apk'),
    true,
  );
  assert.equal(isTrustedInstallSourceUrl('https://example.com/app.zip'), false);
  assert.equal(
    isTrustedInstallSourceUrl('https://github.com/acme/app/archive/refs/heads/main.zip'),
    false,
  );
  assert.equal(isTrustedInstallSourceUrl('https://expo.dev/pricing'), false);
});

test('materializeInstallablePath rejects archive extraction when disabled', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-install-source-archive-'));
  const archivePath = path.join(tempRoot, 'bundle.zip');
  await fs.writeFile(archivePath, 'placeholder');
  try {
    await assert.rejects(
      async () =>
        await materializeInstallablePath({
          source: { kind: 'path', path: archivePath },
          isInstallablePath: () => false,
          installableLabel: 'Android installable (.apk or .aab)',
          allowArchiveExtraction: false,
        }),
      /archive extraction is not allowed/i,
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('prepareIosInstallArtifact rejects untrusted URL sources', async () => {
  await assert.rejects(
    async () =>
      await prepareIosInstallArtifact({
        kind: 'url',
        url: 'https://example.com/app.ipa',
      }),
    /only supported for trusted artifact services/i,
  );
});

test('prepareAndroidInstallArtifact resolves package identity for direct APK URL sources even when untrusted', async (t) => {
  const previous = process.env.AGENT_DEVICE_ALLOW_PRIVATE_SOURCE_URLS;
  process.env.AGENT_DEVICE_ALLOW_PRIVATE_SOURCE_URLS = '1';

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-direct-apk-url-'));
  const manifestPath = path.join(tempRoot, 'AndroidManifest.xml');
  const apkPath = path.join(tempRoot, 'fixture.apk');
  await fs.writeFile(
    manifestPath,
    '<manifest package="io.example.directurl" xmlns:android="http://schemas.android.com/apk/res/android" />',
    'utf8',
  );
  execFileSync('zip', ['-q', apkPath, 'AndroidManifest.xml'], { cwd: tempRoot });
  const apkBytes = await fs.readFile(apkPath);

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/vnd.android.package-archive' });
    res.end(apkBytes);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.rm(tempRoot, { recursive: true, force: true });
    if (previous === undefined) delete process.env.AGENT_DEVICE_ALLOW_PRIVATE_SOURCE_URLS;
    else process.env.AGENT_DEVICE_ALLOW_PRIVATE_SOURCE_URLS = previous;
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const result = await prepareAndroidInstallArtifact({
    kind: 'url',
    url: `http://127.0.0.1:${address.port}/app.apk`,
  });

  try {
    assert.equal(result.packageName, 'io.example.directurl');
  } finally {
    await result.cleanup();
  }
});
