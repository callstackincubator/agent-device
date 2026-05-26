import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { resizePngFileToMaxSize } from '../png.ts';

test('resizePngFileToMaxSize leaves smaller images unchanged', async () => {
  const filePath = tmpPngPath('unchanged');
  const png = new PNG({ width: 4, height: 2 });
  setPngPixel(png, 3, 1, 45, 90, 135);
  writePng(filePath, png);

  await resizePngFileToMaxSize(filePath, 8);

  const unchanged = PNG.sync.read(fs.readFileSync(filePath));
  assert.equal(unchanged.width, 4);
  assert.equal(unchanged.height, 2);
  assert.deepEqual(readPngPixel(unchanged, 3, 1), [45, 90, 135, 255]);
});

function tmpPngPath(prefix: string): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), `agent-device-png-${prefix}-`)),
    'image.png',
  );
}

function writePng(filePath: string, png: PNG): void {
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

function setPngPixel(
  png: PNG,
  x: number,
  y: number,
  red: number,
  green: number,
  blue: number,
  alpha = 255,
): void {
  const offset = (y * png.width + x) * 4;
  png.data[offset] = red;
  png.data[offset + 1] = green;
  png.data[offset + 2] = blue;
  png.data[offset + 3] = alpha;
}

function readPngPixel(png: PNG, x: number, y: number): number[] {
  const offset = (y * png.width + x) * 4;
  return [
    png.data[offset] ?? 0,
    png.data[offset + 1] ?? 0,
    png.data[offset + 2] ?? 0,
    png.data[offset + 3] ?? 0,
  ];
}
