import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAndroidFeatureListForTv,
  parseAndroidTargetFromCharacteristics,
} from '../devices.ts';

test('parseAndroidTargetFromCharacteristics detects tv markers', () => {
  assert.equal(parseAndroidTargetFromCharacteristics('tv,nosdcard'), 'tv');
  assert.equal(parseAndroidTargetFromCharacteristics('watch,leanback'), 'tv');
  assert.equal(parseAndroidTargetFromCharacteristics('phone,tablet'), null);
});

test('parseAndroidFeatureListForTv detects television and leanback features', () => {
  const tvFeatures = [
    'feature:android.software.leanback',
    'feature:android.hardware.type.television',
  ].join('\n');
  assert.equal(parseAndroidFeatureListForTv(tvFeatures), true);
  assert.equal(parseAndroidFeatureListForTv('feature:android.hardware.camera'), false);
});
