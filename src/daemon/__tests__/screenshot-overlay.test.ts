import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { attachRefs, type SnapshotState } from '../../utils/snapshot.ts';
import { annotateScreenshotWithRefs, buildScreenshotOverlayRefs } from '../screenshot-overlay.ts';

function makeSnapshotState(nodes: Parameters<typeof attachRefs>[0]): SnapshotState {
  return {
    nodes: attachRefs(nodes),
    createdAt: Date.now(),
  };
}

function writeSolidPng(filePath: string, width: number, height: number): void {
  const png = new PNG({ width, height });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = 255;
    png.data[index + 1] = 255;
    png.data[index + 2] = 255;
    png.data[index + 3] = 255;
  }
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

test('buildScreenshotOverlayRefs reuses existing eN refs and promotes labeled children to hittable ancestors', () => {
  const snapshot = makeSnapshotState([
    {
      index: 0,
      type: 'XCUIElementTypeButton',
      hittable: true,
      rect: { x: 0, y: 0, width: 40, height: 20 },
    },
    {
      index: 1,
      parentIndex: 0,
      type: 'XCUIElementTypeStaticText',
      label: 'Continue',
      rect: { x: 2, y: 2, width: 30, height: 12 },
    },
  ]);

  const overlayRefs = buildScreenshotOverlayRefs(snapshot, 200, 100);

  assert.equal(overlayRefs.length, 1);
  assert.equal(overlayRefs[0]?.ref, 'e1');
  assert.equal(overlayRefs[0]?.label, 'Continue');
});

test('buildScreenshotOverlayRefs suppresses nested duplicates with the same label', () => {
  const snapshot = makeSnapshotState([
    {
      index: 0,
      type: 'XCUIElementTypeButton',
      label: 'Continue',
      hittable: true,
      rect: { x: 0, y: 0, width: 80, height: 40 },
    },
    {
      index: 1,
      parentIndex: 0,
      type: 'XCUIElementTypeButton',
      label: 'Continue',
      hittable: true,
      rect: { x: 10, y: 10, width: 30, height: 16 },
    },
  ]);

  const overlayRefs = buildScreenshotOverlayRefs(snapshot, 200, 100);

  assert.deepEqual(
    overlayRefs.map((overlayRef) => overlayRef.ref),
    ['e2'],
  );
});

test('annotateScreenshotWithRefs draws the overlay onto the saved PNG', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-screenshot-overlay-'));
  const screenshotPath = path.join(root, 'screen.png');
  writeSolidPng(screenshotPath, 100, 50);
  const snapshot = makeSnapshotState([
    {
      index: 0,
      type: 'XCUIElementTypeButton',
      label: 'Login',
      hittable: true,
      rect: { x: 10, y: 10, width: 20, height: 10 },
    },
  ]);

  const overlayRefs = await annotateScreenshotWithRefs({
    screenshotPath,
    snapshot,
  });

  assert.equal(overlayRefs.length, 1);
  const png = PNG.sync.read(fs.readFileSync(screenshotPath));
  const borderPixelIndex = (png.width * 10 + 10) * 4;
  assert.notDeepEqual(
    Array.from(png.data.slice(borderPixelIndex, borderPixelIndex + 4)),
    [255, 255, 255, 255],
  );
});
