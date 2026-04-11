import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  ARCHIVE_EXTENSIONS,
  isTrustedInstallSourceUrl,
  materializeInstallablePath,
  validateDownloadSourceUrl,
} from '../install-source.ts';

test('public install-source entrypoint re-exports pure helpers', () => {
  assert.deepEqual(ARCHIVE_EXTENSIONS, ['.zip', '.tar', '.tar.gz', '.tgz']);
  assert.equal(
    isTrustedInstallSourceUrl('https://api.github.com/repos/acme/app/actions/artifacts/1/zip'),
    true,
  );
  assert.equal(typeof materializeInstallablePath, 'function');
  assert.equal(typeof validateDownloadSourceUrl, 'function');
});
