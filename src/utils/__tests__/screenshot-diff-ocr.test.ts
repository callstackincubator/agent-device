import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import {
  matchOcrBlocks,
  parseTesseractTsv,
  summarizeScreenshotOcr,
  summarizeOcrMovementClusters,
  summarizeOcrTextChanges,
} from '../screenshot-diff-ocr.ts';

test('parseTesseractTsv groups word rows into text line blocks', () => {
  const blocks = parseTesseractTsv(
    [
      'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
      '5\t1\t1\t1\t1\t1\t100\t200\t40\t20\t96\tAirplane',
      '5\t1\t1\t1\t1\t2\t150\t200\t30\t20\t94\tMode',
      '5\t1\t1\t1\t1\t3\t300\t200\t90\t20\t92\tDisconnected',
      '5\t1\t1\t1\t2\t1\t100\t240\t50\t20\t90\tWi-Fi',
      '5\t1\t1\t1\t3\t1\t100\t280\t10\t20\t-1\t',
    ].join('\n'),
    400,
    800,
  );

  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[0], {
    text: 'Airplane Mode',
    confidence: 95,
    rect: { x: 100, y: 200, width: 80, height: 20 },
    normalizedRect: { x: 25, y: 25, width: 20, height: 2.5 },
  });
  assert.deepEqual(blocks[1], {
    text: 'Disconnected',
    confidence: 92,
    rect: { x: 300, y: 200, width: 90, height: 20 },
    normalizedRect: { x: 75, y: 25, width: 22.5, height: 2.5 },
  });
  assert.deepEqual(blocks[2], {
    text: 'Wi-Fi',
    confidence: 90,
    rect: { x: 100, y: 240, width: 50, height: 20 },
    normalizedRect: { x: 25, y: 30, width: 12.5, height: 2.5 },
  });
});

test('matchOcrBlocks reports movement and OCR bbox size change', () => {
  const matches = matchOcrBlocks(
    [
      {
        text: 'Wi-Fi',
        confidence: 96,
        rect: { x: 100, y: 200, width: 50, height: 20 },
        normalizedRect: { x: 25, y: 25, width: 12.5, height: 2.5 },
      },
    ],
    [
      {
        text: 'Wi-Fi',
        confidence: 94,
        rect: { x: 112, y: 192, width: 60, height: 20 },
        normalizedRect: { x: 28, y: 24, width: 15, height: 2.5 },
      },
    ],
  );

  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0]?.delta, { x: 12, y: -8, width: 10, height: 0 });
  assert.equal(matches[0]?.possibleTextMetricMismatch, true);
});

test('summarizeOcrTextChanges normalizes noisy OCR labels before reporting candidates', () => {
  const changes = summarizeOcrTextChanges(
    [
      {
        text: 'Airplane Mode',
        confidence: 95,
        rect: { x: 100, y: 200, width: 80, height: 20 },
        normalizedRect: { x: 25, y: 25, width: 20, height: 2.5 },
      },
      {
        text: '2) Personal Hotspot',
        confidence: 90,
        rect: { x: 100, y: 260, width: 160, height: 20 },
        normalizedRect: { x: 25, y: 32.5, width: 40, height: 2.5 },
      },
      {
        text: 'Removed Row',
        confidence: 91,
        rect: { x: 100, y: 320, width: 140, height: 20 },
        normalizedRect: { x: 25, y: 40, width: 35, height: 2.5 },
      },
      {
        text: '4:44',
        confidence: 96,
        rect: { x: 10, y: 20, width: 60, height: 20 },
        normalizedRect: { x: 2.5, y: 2.5, width: 15, height: 2.5 },
      },
    ],
    [
      {
        text: 'Airplane Mode @e~',
        confidence: 91,
        rect: { x: 120, y: 210, width: 120, height: 20 },
        normalizedRect: { x: 30, y: 26.25, width: 30, height: 2.5 },
      },
      {
        text: 'Personal Hotspot',
        confidence: 92,
        rect: { x: 120, y: 270, width: 140, height: 20 },
        normalizedRect: { x: 30, y: 33.75, width: 35, height: 2.5 },
      },
      {
        text: 'Added Row',
        confidence: 93,
        rect: { x: 120, y: 340, width: 110, height: 20 },
        normalizedRect: { x: 30, y: 42.5, width: 27.5, height: 2.5 },
      },
    ],
    800,
  );

  assert.deepEqual(
    changes.addedText.map((change) => change.text),
    ['Added Row'],
  );
  assert.deepEqual(
    changes.removedText.map((change) => change.text),
    ['Removed Row'],
  );
});

test('summarizeOcrMovementClusters groups repeated x-axis text movement', () => {
  const clusters = summarizeOcrMovementClusters([
    {
      text: 'Wi-Fi',
      baselineRect: { x: 100, y: 200, width: 50, height: 20 },
      currentRect: { x: 286, y: 120, width: 50, height: 20 },
      delta: { x: 186, y: -80, width: 0, height: 0 },
      confidence: 96,
      possibleTextMetricMismatch: false,
    },
    {
      text: 'Bluetooth',
      baselineRect: { x: 100, y: 260, width: 90, height: 20 },
      currentRect: { x: 284, y: 190, width: 90, height: 20 },
      delta: { x: 184, y: -70, width: 0, height: 0 },
      confidence: 90,
      possibleTextMetricMismatch: false,
    },
    {
      text: 'Search',
      baselineRect: { x: 100, y: 500, width: 90, height: 20 },
      currentRect: { x: 52, y: 560, width: 90, height: 20 },
      delta: { x: -48, y: 60, width: 0, height: 0 },
      confidence: 94,
      possibleTextMetricMismatch: false,
    },
  ]);

  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0]?.texts, ['Wi-Fi', 'Bluetooth']);
  assert.deepEqual(clusters[0]?.xRange, { min: 184, max: 186 });
  assert.deepEqual(clusters[0]?.yRange, { min: -80, max: -70 });
});

test('summarizeScreenshotOcr returns undefined when tesseract exits non-zero', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-test-'));
  const binDir = path.join(dir, 'bin');
  const fakeTesseract = path.join(binDir, 'tesseract');
  const originalPath = process.env.PATH;
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(fakeTesseract, '#!/bin/sh\nexit 2\n');
  fs.chmodSync(fakeTesseract, 0o755);
  process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ''}`;

  try {
    const result = await summarizeScreenshotOcr({
      baselinePath: path.join(dir, 'baseline.png'),
      currentPath: path.join(dir, 'current.png'),
      width: 100,
      height: 100,
    });
    assert.equal(result, undefined);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
