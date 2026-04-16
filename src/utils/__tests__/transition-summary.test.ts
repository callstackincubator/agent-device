import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { summarizeFrameTransitions, type FrameSample } from '../transition-summary.ts';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-transition-summary-'));
}

function writeSettingsFrame(filePath: string, xOffset: number): void {
  const png = new PNG({ width: 120, height: 180 });
  paintRect(png, { x: 0, y: 0, width: 120, height: 180 }, { r: 242, g: 242, b: 247 });
  paintRect(png, { x: 0, y: 0, width: 120, height: 36 }, { r: 248, g: 248, b: 248 });
  paintRect(png, { x: 10 + xOffset, y: 54, width: 100, height: 38 }, { r: 255, g: 255, b: 255 });
  paintRect(png, { x: 18 + xOffset, y: 66, width: 36, height: 8 }, { r: 30, g: 30, b: 30 });
  paintRect(png, { x: 96 + xOffset, y: 66, width: 6, height: 10 }, { r: 130, g: 130, b: 130 });
  paintRect(png, { x: 10 + xOffset, y: 100, width: 100, height: 38 }, { r: 255, g: 255, b: 255 });
  paintRect(png, { x: 18 + xOffset, y: 112, width: 48, height: 8 }, { r: 30, g: 30, b: 30 });
  paintRect(png, { x: 96 + xOffset, y: 112, width: 6, height: 10 }, { r: 130, g: 130, b: 130 });
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

function paintRect(
  png: PNG,
  rect: { x: number; y: number; width: number; height: number },
  color: { r: number; g: number; b: number },
): void {
  const startX = Math.max(0, rect.x);
  const endX = Math.min(png.width, rect.x + rect.width);
  const startY = Math.max(0, rect.y);
  const endY = Math.min(png.height, rect.y + rect.height);
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const index = (y * png.width + x) * 4;
      png.data[index] = color.r;
      png.data[index + 1] = color.g;
      png.data[index + 2] = color.b;
      png.data[index + 3] = 255;
    }
  }
}

test('summarizes a Settings-like transition and anchors it to telemetry', async () => {
  const dir = tmpDir();
  const outputDir = path.join(dir, 'out');
  const offsets = [0, -10, -24, -36, -36];
  const frames: FrameSample[] = offsets.map((offset, index) => {
    const framePath = path.join(dir, `settings-${index}.png`);
    writeSettingsFrame(framePath, offset);
    return { index, path: framePath, timestampMs: index * 120 };
  });
  const telemetryPath = path.join(dir, 'settings.gesture-telemetry.json');
  fs.writeFileSync(
    telemetryPath,
    JSON.stringify({
      version: 1,
      generatedAt: new Date(0).toISOString(),
      events: [{ kind: 'tap', tMs: 20, x: 96, y: 66, referenceWidth: 120, referenceHeight: 180 }],
    }),
  );

  try {
    const result = await summarizeFrameTransitions({
      frames,
      input: {
        kind: 'frames',
        frameCount: frames.length,
        sampledFrameCount: frames.length,
        telemetryPath,
      },
      options: {
        threshold: 0,
        outputDir,
        telemetryPath,
      },
    });

    assert.equal(result.transitions.length, 1);
    assert.equal(result.transitions[0]?.trigger, 'after tap x=96 y=66');
    assert.ok(result.transitions[0]?.peakMismatchPercentage);
    assert.ok(result.transitions[0]?.regions?.length);
    assert.equal(fs.existsSync(result.transitions[0]?.keyframes.diff ?? ''), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
