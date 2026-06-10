import { test } from 'vitest';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { PNG } from '../png.ts';

test('PNG sync reader decodes filtered RGB image data', () => {
  const png = PNG.sync.read(
    encodeTestPng({
      width: 2,
      height: 1,
      bitDepth: 8,
      colorType: 2,
      rawScanlines: Buffer.from([1, 10, 20, 30, 40, 60, 100]),
    }),
  );

  assert.equal(png.width, 2);
  assert.equal(png.height, 1);
  assert.deepEqual(readPngPixel(png, 0, 0), [10, 20, 30, 255]);
  assert.deepEqual(readPngPixel(png, 1, 0), [50, 80, 130, 255]);
});

test('PNG sync reader decodes indexed color and transparency', () => {
  const png = PNG.sync.read(
    encodeTestPng({
      width: 4,
      height: 1,
      bitDepth: 2,
      colorType: 3,
      palette: Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 20, 30, 40]),
      transparency: Buffer.from([255, 200, 80, 255]),
      rawScanlines: Buffer.from([0, 0b00011011]),
    }),
  );

  assert.deepEqual(readPngPixel(png, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(readPngPixel(png, 1, 0), [0, 255, 0, 200]);
  assert.deepEqual(readPngPixel(png, 2, 0), [0, 0, 255, 80]);
  assert.deepEqual(readPngPixel(png, 3, 0), [20, 30, 40, 255]);
});

test('PNG sync reader decodes RGBA alpha', () => {
  const png = PNG.sync.read(
    encodeTestPng({
      width: 1,
      height: 1,
      bitDepth: 8,
      colorType: 6,
      rawScanlines: Buffer.from([0, 10, 20, 30, 40]),
    }),
  );

  assert.deepEqual(readPngPixel(png, 0, 0), [10, 20, 30, 40]);
});

test('PNG sync reader scales 16-bit samples to 8-bit output', () => {
  const rawScanlines = Buffer.alloc(7);
  rawScanlines[0] = 0;
  rawScanlines.writeUInt16BE(0x00ff, 1);
  rawScanlines.writeUInt16BE(0x0100, 3);
  rawScanlines.writeUInt16BE(0xffff, 5);

  const png = PNG.sync.read(
    encodeTestPng({
      width: 1,
      height: 1,
      bitDepth: 16,
      colorType: 2,
      rawScanlines,
    }),
  );

  assert.deepEqual(readPngPixel(png, 0, 0), [1, 1, 255, 255]);
});

test('PNG sync reader applies packed grayscale transparency', () => {
  const png = PNG.sync.read(
    encodeTestPng({
      width: 2,
      height: 1,
      bitDepth: 4,
      colorType: 0,
      transparency: Buffer.from([0, 2]),
      rawScanlines: Buffer.from([0, 0x25]),
    }),
  );

  assert.deepEqual(readPngPixel(png, 0, 0), [34, 34, 34, 0]);
  assert.deepEqual(readPngPixel(png, 1, 0), [85, 85, 85, 255]);
});

test('PNG sync reader decodes Adam7 interlaced RGB image data', () => {
  const png = PNG.sync.read(
    encodeTestPng({
      width: 3,
      height: 3,
      bitDepth: 8,
      colorType: 2,
      interlace: 1,
      rawScanlines: Buffer.from([
        0,
        ...rgb(0, 0),
        0,
        ...rgb(2, 0),
        0,
        ...rgb(0, 2),
        ...rgb(2, 2),
        0,
        ...rgb(1, 0),
        0,
        ...rgb(1, 2),
        0,
        ...rgb(0, 1),
        ...rgb(1, 1),
        ...rgb(2, 1),
      ]),
    }),
  );

  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      assert.deepEqual(readPngPixel(png, x, y), [...rgb(x, y), 255]);
    }
  }
});

test('PNG sync reader rejects invalid chunk CRCs', () => {
  const bytes = encodeTestPng({
    width: 1,
    height: 1,
    bitDepth: 8,
    colorType: 2,
    rawScanlines: Buffer.from([0, ...rgb(0, 0)]),
  });
  const lastByte = bytes.length - 1;
  bytes[lastByte] = (bytes[lastByte] ?? 0) ^ 0xff;

  assert.throws(() => PNG.sync.read(bytes), /Invalid PNG .* chunk CRC/);
});

test('PNG sync reader rejects inflated data larger than IHDR scanlines', () => {
  const bytes = encodeTestPng({
    width: 1,
    height: 1,
    bitDepth: 8,
    colorType: 6,
    rawScanlines: Buffer.from([0, 1, 2, 3, 4, 5]),
  });

  assert.throws(() => PNG.sync.read(bytes), /PNG pixel data exceeds expected length 5/);
});

function readPngPixel(png: PNG, x: number, y: number): number[] {
  const offset = (y * png.width + x) * 4;
  return [
    png.data[offset] ?? 0,
    png.data[offset + 1] ?? 0,
    png.data[offset + 2] ?? 0,
    png.data[offset + 3] ?? 0,
  ];
}

function encodeTestPng(params: {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  rawScanlines: Buffer;
  interlace?: 0 | 1;
  palette?: Buffer;
  transparency?: Buffer;
}): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(params.width, 0);
  ihdr.writeUInt32BE(params.height, 4);
  ihdr[8] = params.bitDepth;
  ihdr[9] = params.colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = params.interlace ?? 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    encodeTestChunk('IHDR', ihdr),
    ...(params.palette ? [encodeTestChunk('PLTE', params.palette)] : []),
    ...(params.transparency ? [encodeTestChunk('tRNS', params.transparency)] : []),
    encodeTestChunk('IDAT', deflateSync(params.rawScanlines)),
    encodeTestChunk('IEND', Buffer.alloc(0)),
  ]);
}

function rgb(x: number, y: number): [number, number, number] {
  return [x * 40 + 10, y * 50 + 20, x * 30 + y * 20 + 30];
}

function encodeTestChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(8 + data.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
