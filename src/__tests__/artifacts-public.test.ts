import assert from 'node:assert/strict';
import { test } from 'vitest';

import { resolveAndroidArchivePackageName } from '../artifacts.ts';

const resolver: (archivePath: string) => Promise<string | undefined> =
  resolveAndroidArchivePackageName;

test('package subpath exports android archive package resolver', () => {
  assert.equal(typeof resolver, 'function');
});
