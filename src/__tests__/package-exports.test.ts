import fs from 'node:fs';
import path from 'node:path';
import { test } from 'vitest';
import assert from 'node:assert/strict';

test('package exports only supported public subpaths', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
    exports: Record<string, unknown>;
  };

  assert.equal(pkg.exports['./android-apps'], undefined);
  assert.equal(pkg.exports['./daemon'], undefined);
  assert.equal(pkg.exports['./android-adb'] !== undefined, true);
  assert.equal(pkg.exports['./contracts'] !== undefined, true);
});
