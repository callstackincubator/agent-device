import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveInstallSource } from '../../install-source-resolution.ts';
import { trackUploadedArtifact } from '../../upload-registry.ts';
import type { DaemonRequest } from '../../types.ts';

function makeRequest(meta?: DaemonRequest['meta']): DaemonRequest {
  return {
    token: 't',
    session: 'default',
    command: 'install_source',
    positionals: [],
    flags: { platform: 'android' },
    meta,
  };
}

test('resolveInstallSource uses uploaded artifact path for uploaded path sources', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-install-source-upload-'));
  const artifactPath = path.join(tempRoot, 'Sample.apk');
  fs.writeFileSync(artifactPath, 'apk-binary');
  const uploadedArtifactId = trackUploadedArtifact({ artifactPath, tempDir: tempRoot });

  const resolved = resolveInstallSource(makeRequest({
    uploadedArtifactId,
    installSource: {
      kind: 'path',
      path: '/Users/dev/Downloads/Sample.apk',
    },
  }));

  assert.equal(resolved.source.kind, 'path');
  assert.equal(resolved.source.path, artifactPath);

  resolved.cleanup();
  assert.equal(fs.existsSync(tempRoot), false);
});

test('resolveInstallSource leaves URL sources unchanged even when upload metadata exists', () => {
  const resolved = resolveInstallSource(makeRequest({
    uploadedArtifactId: 'upload-123',
    installSource: {
      kind: 'url',
      url: 'https://example.com/app.apk',
      headers: {},
    },
  }));

  assert.deepEqual(resolved.source, {
    kind: 'url',
    url: 'https://example.com/app.apk',
    headers: {},
  });
  resolved.cleanup();
});
