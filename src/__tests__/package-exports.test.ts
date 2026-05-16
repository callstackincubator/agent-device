import fs from 'node:fs';
import path from 'node:path';
import { test } from 'vitest';
import assert from 'node:assert/strict';

test('package exports only supported public subpaths', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
    exports: Record<string, unknown>;
  };

  const supportedSubpaths = [
    '.',
    './io',
    './artifacts',
    './metro',
    './batch',
    './remote-config',
    './install-source',
    './android-adb',
    './android-snapshot-helper',
    './contracts',
    './selectors',
    './finders',
  ];

  for (const subpath of supportedSubpaths) {
    assert.equal(pkg.exports[subpath] !== undefined, true, `${subpath} should be exported`);
  }

  assert.equal(pkg.exports['./android-apps'], undefined);
  assert.equal(pkg.exports['./daemon'], undefined);
});
