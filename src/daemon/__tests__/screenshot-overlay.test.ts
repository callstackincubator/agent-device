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

test('buildScreenshotOverlayRefs promotes labeled children to actionable ancestors before hittable roots', () => {
  const snapshot = makeSnapshotState([
    {
      index: 0,
      type: 'XCUIElementTypeApplication',
      label: 'Settings',
      hittable: true,
      rect: { x: 0, y: 0, width: 100, height: 200 },
    },
    {
      index: 1,
      parentIndex: 0,
      type: 'XCUIElementTypeButton',
      label: 'General',
      rect: { x: 10, y: 20, width: 80, height: 30 },
    },
    {
      index: 2,
      parentIndex: 1,
      type: 'XCUIElementTypeStaticText',
      label: 'General',
      rect: { x: 14, y: 26, width: 40, height: 12 },
    },
  ]);

  const overlayRefs = buildScreenshotOverlayRefs(snapshot, 200, 400);

  assert.deepEqual(overlayRefs, [
    {
      ref: 'e2',
      label: 'General',
      rect: { x: 10, y: 20, width: 80, height: 30 },
      overlayRect: { x: 20, y: 40, width: 160, height: 60 },
      center: { x: 100, y: 70 },
    },
  ]);
});

test('buildScreenshotOverlayRefs suppresses contained duplicates with the same label, keeping the smaller rect', () => {
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

test('buildScreenshotOverlayRefs projects against the viewport instead of snapshot outliers', () => {
  const snapshot = makeSnapshotState([
    {
      index: 0,
      type: 'XCUIElementTypeApplication',
      label: 'Settings',
      rect: { x: 0, y: 0, width: 100, height: 200 },
    },
    {
      index: 1,
      parentIndex: 0,
      type: 'XCUIElementTypeImage',
      rect: { x: -30, y: 150, width: 160, height: 40 },
    },
    {
      index: 2,
      parentIndex: 0,
      type: 'XCUIElementTypeButton',
      label: 'Continue',
      rect: { x: 10, y: 20, width: 80, height: 30 },
    },
  ]);

  const overlayRefs = buildScreenshotOverlayRefs(snapshot, 200, 400);

  assert.deepEqual(overlayRefs[0]?.overlayRect, {
    x: 20,
    y: 40,
    width: 160,
    height: 60,
  });
  assert.deepEqual(overlayRefs[0]?.center, {
    x: 100,
    y: 70,
  });
});

test('buildScreenshotOverlayRefs skips generic actionable container labels when specific children exist', () => {
  const snapshot = makeSnapshotState([
    {
      index: 0,
      type: 'XCUIElementTypeApplication',
      rect: { x: 0, y: 0, width: 100, height: 200 },
    },
    {
      index: 1,
      parentIndex: 0,
      type: 'XCUIElementTypeSearchField',
      label: 'Toolbar',
      rect: { x: 0, y: 150, width: 100, height: 30 },
    },
    {
      index: 2,
      parentIndex: 1,
      type: 'XCUIElementTypeSearchField',
      label: 'Search',
      rect: { x: 8, y: 154, width: 70, height: 20 },
    },
  ]);

  const overlayRefs = buildScreenshotOverlayRefs(snapshot, 200, 400);

  assert.deepEqual(
    overlayRefs.map((overlayRef) => overlayRef.label),
    ['Search'],
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
