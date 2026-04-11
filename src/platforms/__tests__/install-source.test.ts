import { test, onTestFinished } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ARCHIVE_EXTENSIONS,
  isBlockedIpAddress,
  isBlockedSourceHostname,
  isTrustedInstallSourceUrl,
  materializeInstallablePath,
  validateDownloadSourceUrl,
} from '../../install-source.ts';
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

test('public install-source helpers expose the SSRF and archive surface', () => {
  assert.deepEqual(ARCHIVE_EXTENSIONS, ['.zip', '.tar', '.tar.gz', '.tgz']);
  assert.equal(Object.isFrozen(ARCHIVE_EXTENSIONS), true);
  assert.equal(isBlockedSourceHostname('localhost'), true);
  assert.equal(isBlockedSourceHostname('example.com'), false);
  assert.equal(isBlockedIpAddress('127.0.0.1'), true);
  assert.equal(isBlockedIpAddress('203.0.113.10'), false);
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

test.sequential('materializeInstallablePath extracts zip archives without ditto', async () => {
  const unzipPath = findExecutableInPath('unzip');
  assert.ok(unzipPath, 'unzip must be available for portable zip extraction');

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-install-source-unzip-'));
  const archivePath = path.join(tempRoot, 'bundle.zip');
  const binDir = path.join(tempRoot, 'bin');
  const payloadDir = path.join(tempRoot, 'payload');
  const apkPath = path.join(payloadDir, 'Sample.apk');
  const previousPath = process.env.PATH;

  try {
    await fs.mkdir(binDir);
    await fs.symlink(unzipPath, path.join(binDir, 'unzip'));
    await fs.mkdir(payloadDir);
    await fs.writeFile(apkPath, 'placeholder apk', 'utf8');
    execFileSync('zip', ['-qr', archivePath, 'payload'], { cwd: tempRoot });

    process.env.PATH = binDir;
    const result = await materializeInstallablePath({
      source: { kind: 'path', path: archivePath },
      isInstallablePath: (candidatePath, stat) => stat.isFile() && candidatePath.endsWith('.apk'),
      installableLabel: 'Android installable (.apk or .aab)',
      allowArchiveExtraction: true,
    });

    try {
      assert.equal(path.basename(result.installablePath), 'Sample.apk');
      assert.equal(await fs.readFile(result.installablePath, 'utf8'), 'placeholder apk');
    } finally {
      await result.cleanup();
    }
  } finally {
    process.env.PATH = previousPath;
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

test('prepareAndroidInstallArtifact resolves package identity for direct APK URL sources even when untrusted', async () => {
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
  onTestFinished(async () => {
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

function findExecutableInPath(command: string): string | undefined {
  const pathValue = process.env.PATH;
  if (!pathValue) return undefined;
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, command);
    try {
      if (!fsSync.statSync(candidate).isFile()) continue;
      fsSync.accessSync(candidate, fsSync.constants.X_OK);
      return candidate;
    } catch {
      // Keep scanning PATH.
    }
  }
  return undefined;
}
