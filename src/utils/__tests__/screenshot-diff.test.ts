import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { compareScreenshots } from '../screenshot-diff.ts';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-screenshot-diff-'));
}

/** Create a solid-color PNG and write it to disk. */
function writeSolidPng(
  filePath: string,
  width: number,
  height: number,
  color: { r: number; g: number; b: number },
): void {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = color.r;
    png.data[i + 1] = color.g;
    png.data[i + 2] = color.b;
    png.data[i + 3] = 255;
  }
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

test('identical images produce match: true with 0% mismatch', async () => {
  const dir = tmpDir();
  const baseline = path.join(dir, 'baseline.png');
  const current = path.join(dir, 'current.png');
  const diffOut = path.join(dir, 'diff.png');

  writeSolidPng(baseline, 10, 10, { r: 100, g: 150, b: 200 });
  writeSolidPng(current, 10, 10, { r: 100, g: 150, b: 200 });

  const result = await compareScreenshots(baseline, current, { outputPath: diffOut });

  assert.equal(result.match, true);
  assert.equal(result.differentPixels, 0);
  assert.equal(result.mismatchPercentage, 0);
  assert.equal(result.totalPixels, 100);
  assert.equal(result.dimensionMismatch, undefined);
  assert.equal(result.diffPath, undefined, 'diffPath should not be set when images match');
  // No diff image should be written when images match
  assert.equal(fs.existsSync(diffOut), false);
});

test('matching images delete an existing diff artifact at outputPath', async () => {
  const dir = tmpDir();
  const baseline = path.join(dir, 'baseline.png');
  const current = path.join(dir, 'current.png');
  const diffOut = path.join(dir, 'diff.png');

  writeSolidPng(baseline, 10, 10, { r: 100, g: 150, b: 200 });
  writeSolidPng(current, 10, 10, { r: 100, g: 150, b: 200 });
  fs.writeFileSync(diffOut, 'stale diff');

  const result = await compareScreenshots(baseline, current, { outputPath: diffOut });

  assert.equal(result.match, true);
  assert.equal(fs.existsSync(diffOut), false);
});

test('completely different images produce match: false with 100% mismatch', async () => {
  const dir = tmpDir();
  const baseline = path.join(dir, 'baseline.png');
  const current = path.join(dir, 'current.png');
  const diffOut = path.join(dir, 'diff.png');

  writeSolidPng(baseline, 10, 10, { r: 0, g: 0, b: 0 });
  writeSolidPng(current, 10, 10, { r: 255, g: 255, b: 255 });

  const result = await compareScreenshots(baseline, current, {
    outputPath: diffOut,
    threshold: 0,
  });

  assert.equal(result.match, false);
  assert.equal(result.differentPixels, 100);
  assert.equal(result.mismatchPercentage, 100);
  assert.equal(result.totalPixels, 100);
  assert.ok(fs.existsSync(diffOut), 'diff image should be written');
});

test('generated diff path defaults under os.tmpdir when outputPath is omitted', async () => {
  const dir = tmpDir();
  const baseline = path.join(dir, 'baseline.png');
  const current = path.join(dir, 'current.png');

  writeSolidPng(baseline, 10, 10, { r: 0, g: 0, b: 0 });
  writeSolidPng(current, 10, 10, { r: 255, g: 255, b: 255 });

  const result = await compareScreenshots(baseline, current, { threshold: 0 });

  assert.equal(result.match, false);
  assert.equal(typeof result.diffPath, 'string');
  assert.equal(result.diffPath!.startsWith(path.join(os.tmpdir(), 'agent-device', 'tmp', 'diffs')), true);
  assert.equal(fs.existsSync(result.diffPath!), true);
});

test('diff image marks different pixels as red and unchanged as dimmed gray', async () => {
  const dir = tmpDir();
  const baseline = path.join(dir, 'baseline.png');
  const current = path.join(dir, 'current.png');
  const diffOut = path.join(dir, 'diff.png');

  // 2x1 image: first pixel identical, second pixel different
  const baselinePng = new PNG({ width: 2, height: 1 });
  // pixel 0: white
  baselinePng.data[0] = 255; baselinePng.data[1] = 255;
  baselinePng.data[2] = 255; baselinePng.data[3] = 255;
  // pixel 1: black
  baselinePng.data[4] = 0; baselinePng.data[5] = 0;
  baselinePng.data[6] = 0; baselinePng.data[7] = 255;
  fs.writeFileSync(baseline, PNG.sync.write(baselinePng));

  const currentPng = new PNG({ width: 2, height: 1 });
  // pixel 0: white (same)
  currentPng.data[0] = 255; currentPng.data[1] = 255;
  currentPng.data[2] = 255; currentPng.data[3] = 255;
  // pixel 1: white (different from black)
  currentPng.data[4] = 255; currentPng.data[5] = 255;
  currentPng.data[6] = 255; currentPng.data[7] = 255;
  fs.writeFileSync(current, PNG.sync.write(currentPng));

  const result = await compareScreenshots(baseline, current, {
    outputPath: diffOut,
    threshold: 0,
  });

  assert.equal(result.differentPixels, 1);
  assert.equal(result.totalPixels, 2);

  // Read the diff image and verify pixel colors
  const diffPng = PNG.sync.read(fs.readFileSync(diffOut));

  // Pixel 0 (unchanged white): should be dimmed gray
  // gray = round((255+255+255)/3) = 255, dimmed = round(255*0.3) = 77
  assert.equal(diffPng.data[0], 77); // R
  assert.equal(diffPng.data[1], 77); // G
  assert.equal(diffPng.data[2], 77); // B

  // Pixel 1 (different): should be red
  assert.equal(diffPng.data[4], 255); // R
  assert.equal(diffPng.data[5], 0);   // G
  assert.equal(diffPng.data[6], 0);   // B
});

test('dimension mismatch returns expected vs actual sizes', async () => {
  const dir = tmpDir();
  const baseline = path.join(dir, 'baseline.png');
  const current = path.join(dir, 'current.png');
  const diffOut = path.join(dir, 'diff.png');

  writeSolidPng(baseline, 10, 20, { r: 0, g: 0, b: 0 });
  writeSolidPng(current, 15, 25, { r: 0, g: 0, b: 0 });

  const result = await compareScreenshots(baseline, current, { outputPath: diffOut });

  assert.equal(result.match, false);
  assert.equal(result.mismatchPercentage, 100);
  assert.equal(result.diffPath, undefined, 'diffPath should not be set for dimension mismatch');
  assert.deepEqual(result.dimensionMismatch, {
    expected: { width: 10, height: 20 },
    actual: { width: 15, height: 25 },
  });
});

test('threshold controls sensitivity: small differences ignored at default threshold', async () => {
  const dir = tmpDir();
  const baseline = path.join(dir, 'baseline.png');
  const current = path.join(dir, 'current.png');

  // Colors differ by just a few units — within default threshold of 0.1
  writeSolidPng(baseline, 5, 5, { r: 100, g: 100, b: 100 });
  writeSolidPng(current, 5, 5, { r: 105, g: 105, b: 105 });

  const loose = await compareScreenshots(baseline, current, {
    outputPath: path.join(dir, 'diff-loose.png'),
    threshold: 0.1,
  });
  assert.equal(loose.match, true, 'small color difference should be ignored at 0.1 threshold');

  const strict = await compareScreenshots(baseline, current, {
    outputPath: path.join(dir, 'diff-strict.png'),
    threshold: 0,
  });
  assert.equal(strict.match, false, 'small color difference should be detected at 0 threshold');
  assert.equal(strict.differentPixels, 25);
});

test('throws INVALID_ARGS when baseline file does not exist', async () => {
  const dir = tmpDir();
  const current = path.join(dir, 'current.png');
  writeSolidPng(current, 5, 5, { r: 0, g: 0, b: 0 });

  await assert.rejects(
    () => compareScreenshots(path.join(dir, 'missing.png'), current),
    (err: any) => {
      assert.equal(err.code, 'INVALID_ARGS');
      assert.match(err.message, /Baseline image not found/);
      return true;
    },
  );
});

test('throws INVALID_ARGS when current file does not exist', async () => {
  const dir = tmpDir();
  const baseline = path.join(dir, 'baseline.png');
  writeSolidPng(baseline, 5, 5, { r: 0, g: 0, b: 0 });

  await assert.rejects(
    () => compareScreenshots(baseline, path.join(dir, 'missing.png')),
    (err: any) => {
      assert.equal(err.code, 'INVALID_ARGS');
      assert.match(err.message, /Current screenshot not found/);
      return true;
    },
  );
});

test('throws COMMAND_FAILED for invalid PNG data', async () => {
  const dir = tmpDir();
  const baseline = path.join(dir, 'baseline.png');
  const current = path.join(dir, 'current.png');

  fs.writeFileSync(baseline, 'not a png file');
  writeSolidPng(current, 5, 5, { r: 0, g: 0, b: 0 });

  await assert.rejects(
    () => compareScreenshots(baseline, current),
    (err: any) => {
      assert.equal(err.code, 'COMMAND_FAILED');
      assert.match(err.message, /Failed to decode baseline screenshot/);
      return true;
    },
  );
});

test('mismatchPercentage is rounded to 2 decimal places', async () => {
  const dir = tmpDir();
  const baseline = path.join(dir, 'baseline.png');
  const current = path.join(dir, 'current.png');

  // 3x1 image: change 1 of 3 pixels → 33.333...%
  const baselinePng = new PNG({ width: 3, height: 1 });
  const currentPng = new PNG({ width: 3, height: 1 });
  for (let i = 0; i < 12; i += 4) {
    baselinePng.data[i] = 0; baselinePng.data[i + 1] = 0;
    baselinePng.data[i + 2] = 0; baselinePng.data[i + 3] = 255;
    currentPng.data[i] = 0; currentPng.data[i + 1] = 0;
    currentPng.data[i + 2] = 0; currentPng.data[i + 3] = 255;
  }
  // Make the last pixel different
  currentPng.data[8] = 255;
  currentPng.data[9] = 255;
  currentPng.data[10] = 255;

  fs.writeFileSync(baseline, PNG.sync.write(baselinePng));
  fs.writeFileSync(current, PNG.sync.write(currentPng));

  const result = await compareScreenshots(baseline, current, {
    outputPath: path.join(dir, 'diff.png'),
    threshold: 0,
  });

  assert.equal(result.mismatchPercentage, 33.33);
});
