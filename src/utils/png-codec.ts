import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type PngColorType = 0 | 2 | 3 | 4 | 6;

const COLOR_CHANNELS: ReadonlyMap<PngColorType, number> = new Map([
  [0, 1],
  [2, 3],
  [3, 1],
  [4, 2],
  [6, 4],
] as const);
const VALID_BIT_DEPTHS: ReadonlyMap<PngColorType, ReadonlySet<number>> = new Map([
  [0, new Set([1, 2, 4, 8, 16])],
  [2, new Set([8, 16])],
  [3, new Set([1, 2, 4, 8])],
  [4, new Set([8, 16])],
  [6, new Set([8, 16])],
] as const);
const ADAM7_PASSES = [
  { x: 0, y: 0, dx: 8, dy: 8 },
  { x: 4, y: 0, dx: 8, dy: 8 },
  { x: 0, y: 4, dx: 4, dy: 8 },
  { x: 2, y: 0, dx: 4, dy: 4 },
  { x: 0, y: 2, dx: 2, dy: 4 },
  { x: 1, y: 0, dx: 2, dy: 2 },
  { x: 0, y: 1, dx: 1, dy: 2 },
] as const;

type PngMetadata = {
  width: number;
  height: number;
  bitDepth: number;
  colorType: PngColorType;
  interlace: 0 | 1;
  palette?: Buffer;
  transparency?: Buffer;
};

export class PNG {
  width: number;
  height: number;
  data: Buffer;

  static sync = {
    read: readPng,
    write: writePng,
  };

  constructor(options: { width: number; height: number; data?: Buffer }) {
    this.width = validateDimension(options.width, 'width');
    this.height = validateDimension(options.height, 'height');
    const byteLength = this.width * this.height * 4;
    this.data = options.data ? Buffer.from(options.data) : Buffer.alloc(byteLength);
    if (this.data.length !== byteLength) {
      throw new Error(`PNG data length must be ${byteLength} bytes`);
    }
  }
}

function readPng(buffer: Buffer): PNG {
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('Invalid PNG signature');
  }

  let metadata: PngMetadata | undefined;
  const idatChunks: Buffer[] = [];
  let offset = PNG_SIGNATURE.length;

  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw new Error('Truncated PNG chunk');
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) throw new Error(`Truncated PNG ${type} chunk`);
    const data = buffer.subarray(dataStart, dataEnd);
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    const actualCrc = crc32(buffer.subarray(offset + 4, dataEnd));
    if (actualCrc !== expectedCrc) throw new Error(`Invalid PNG ${type} chunk CRC`);
    offset = dataEnd + 4;

    if (type === 'IHDR') metadata = parseIhdr(data);
    else if (type === 'PLTE') {
      if (!metadata) throw new Error('PNG PLTE appeared before IHDR');
      metadata.palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      if (!metadata) throw new Error('PNG tRNS appeared before IHDR');
      metadata.transparency = Buffer.from(data);
    } else if (type === 'IDAT') idatChunks.push(Buffer.from(data));
    else if (type === 'IEND') break;
  }

  if (!metadata) throw new Error('PNG is missing IHDR');
  if (idatChunks.length === 0) throw new Error('PNG is missing IDAT');
  const inflated = inflateSync(Buffer.concat(idatChunks));
  return new PNG({
    width: metadata.width,
    height: metadata.height,
    data:
      metadata.interlace === 1
        ? decodeInterlacedPixels(inflated, metadata)
        : decodePixels(unfilterPng(inflated, metadata), metadata),
  });
}

function writePng(png: PNG): Buffer {
  const scanlineLength = png.width * 4;
  const raw = Buffer.alloc((scanlineLength + 1) * png.height);
  for (let y = 0; y < png.height; y += 1) {
    const rawOffset = y * (scanlineLength + 1);
    raw[rawOffset] = 0;
    png.data.copy(raw, rawOffset + 1, y * scanlineLength, (y + 1) * scanlineLength);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(png.width, 0);
  ihdr.writeUInt32BE(png.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    encodeChunk('IHDR', ihdr),
    encodeChunk('IDAT', deflateSync(raw)),
    encodeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function parseIhdr(data: Buffer): PngMetadata {
  if (data.length !== 13) throw new Error('Invalid PNG IHDR length');
  const width = data.readUInt32BE(0);
  const height = data.readUInt32BE(4);
  const bitDepth = data[8]!;
  const colorType = data[9]!;
  const compression = data[10]!;
  const filter = data[11]!;
  const interlace = data[12]!;
  if (!isPngColorType(colorType)) throw new Error(`Unsupported PNG color type ${colorType}`);
  const validDepths = VALID_BIT_DEPTHS.get(colorType);
  if (!validDepths?.has(bitDepth)) {
    throw new Error(`Unsupported PNG color type ${colorType} with bit depth ${bitDepth}`);
  }
  if (compression !== 0) throw new Error(`Unsupported PNG compression method ${compression}`);
  if (filter !== 0) throw new Error(`Unsupported PNG filter method ${filter}`);
  if (interlace !== 0 && interlace !== 1)
    throw new Error(`Unsupported PNG interlace method ${interlace}`);
  return {
    width: validateDimension(width, 'width'),
    height: validateDimension(height, 'height'),
    bitDepth,
    colorType,
    interlace,
  };
}

function isPngColorType(value: number): value is PngColorType {
  return COLOR_CHANNELS.has(value as PngColorType);
}

function unfilterPng(inflated: Buffer, metadata: PngMetadata): Buffer {
  const scanlineLength = scanlineByteLength(metadata);
  const result = unfilterScanlines({
    inflated,
    offset: 0,
    scanlineLength,
    height: metadata.height,
    bytesPerPixel: filterBytesPerPixel(metadata),
  });
  return result.raw;
}

function unfilterScanlines(params: {
  inflated: Buffer;
  offset: number;
  scanlineLength: number;
  height: number;
  bytesPerPixel: number;
}): { raw: Buffer; offset: number } {
  const { inflated, offset, scanlineLength, height, bytesPerPixel } = params;
  const expectedLength = (scanlineLength + 1) * height;
  const endOffset = offset + expectedLength;
  if (inflated.length < endOffset) throw new Error('PNG pixel data is truncated');

  const output = Buffer.alloc(scanlineLength * height);
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = offset + y * (scanlineLength + 1);
    const targetOffset = y * scanlineLength;
    const filter = inflated[sourceOffset]!;
    for (let x = 0; x < scanlineLength; x += 1) {
      const value = inflated[sourceOffset + 1 + x]!;
      const left = x >= bytesPerPixel ? output[targetOffset + x - bytesPerPixel]! : 0;
      const up = y > 0 ? output[targetOffset + x - scanlineLength]! : 0;
      const upLeft =
        y > 0 && x >= bytesPerPixel
          ? output[targetOffset + x - scanlineLength - bytesPerPixel]!
          : 0;
      output[targetOffset + x] = unfilterByte(filter, value, left, up, upLeft);
    }
  }
  return { raw: output, offset: endOffset };
}

function unfilterByte(
  filter: number,
  value: number,
  left: number,
  up: number,
  upLeft: number,
): number {
  if (filter === 0) return value;
  if (filter === 1) return (value + left) & 0xff;
  if (filter === 2) return (value + up) & 0xff;
  if (filter === 3) return (value + Math.floor((left + up) / 2)) & 0xff;
  if (filter === 4) return (value + paeth(left, up, upLeft)) & 0xff;
  throw new Error(`Unsupported PNG filter type ${filter}`);
}

function decodePixels(raw: Buffer, metadata: PngMetadata): Buffer {
  const output = Buffer.alloc(metadata.width * metadata.height * 4);
  const scanlineLength = scanlineByteLength(metadata);
  for (let y = 0; y < metadata.height; y += 1) {
    const line = raw.subarray(y * scanlineLength, (y + 1) * scanlineLength);
    for (let x = 0; x < metadata.width; x += 1) {
      const target = (y * metadata.width + x) * 4;
      const [red, green, blue, alpha] = readPixel(line, x, metadata);
      output[target] = red;
      output[target + 1] = green;
      output[target + 2] = blue;
      output[target + 3] = alpha;
    }
  }
  return output;
}

function decodeInterlacedPixels(inflated: Buffer, metadata: PngMetadata): Buffer {
  const output = Buffer.alloc(metadata.width * metadata.height * 4);
  let offset = 0;
  for (const pass of ADAM7_PASSES) {
    const width = interlacePassSize(metadata.width, pass.x, pass.dx);
    const height = interlacePassSize(metadata.height, pass.y, pass.dy);
    if (width === 0 || height === 0) continue;

    const passMetadata = { ...metadata, width, height, interlace: 0 as const };
    const result = unfilterScanlines({
      inflated,
      offset,
      scanlineLength: scanlineByteLength(passMetadata),
      height,
      bytesPerPixel: filterBytesPerPixel(passMetadata),
    });
    offset = result.offset;

    const scanlineLength = scanlineByteLength(passMetadata);
    for (let y = 0; y < height; y += 1) {
      const line = result.raw.subarray(y * scanlineLength, (y + 1) * scanlineLength);
      for (let x = 0; x < width; x += 1) {
        const targetX = pass.x + x * pass.dx;
        const targetY = pass.y + y * pass.dy;
        const target = (targetY * metadata.width + targetX) * 4;
        const [red, green, blue, alpha] = readPixel(line, x, passMetadata);
        output[target] = red;
        output[target + 1] = green;
        output[target + 2] = blue;
        output[target + 3] = alpha;
      }
    }
  }
  return output;
}

function interlacePassSize(size: number, start: number, step: number): number {
  if (size <= start) return 0;
  return Math.floor((size - start + step - 1) / step);
}

function readPixel(
  line: Buffer,
  x: number,
  metadata: PngMetadata,
): [number, number, number, number] {
  if (metadata.colorType === 3) return readPalettePixel(line, x, metadata);
  if (metadata.bitDepth < 8) return readPackedGrayscalePixel(line, x, metadata);

  const bytesPerSample = metadata.bitDepth === 16 ? 2 : 1;
  const channels = COLOR_CHANNELS.get(metadata.colorType)!;
  const offset = x * channels * bytesPerSample;
  const sample = (channel: number): number => line[offset + channel * bytesPerSample]!;
  const fullSample = (channel: number): number =>
    metadata.bitDepth === 16 ? line.readUInt16BE(offset + channel * 2) : sample(channel);

  if (metadata.colorType === 0) {
    const gray = sample(0);
    const transparent = matchesTransparentGray(fullSample(0), metadata);
    return [gray, gray, gray, transparent ? 0 : 255];
  }
  if (metadata.colorType === 2) {
    const red = sample(0);
    const green = sample(1);
    const blue = sample(2);
    const transparent = matchesTransparentRgb(
      fullSample(0),
      fullSample(1),
      fullSample(2),
      metadata,
    );
    return [red, green, blue, transparent ? 0 : 255];
  }
  if (metadata.colorType === 4) {
    const gray = sample(0);
    return [gray, gray, gray, sample(1)];
  }
  return [sample(0), sample(1), sample(2), sample(3)];
}

function readPalettePixel(
  line: Buffer,
  x: number,
  metadata: PngMetadata,
): [number, number, number, number] {
  if (!metadata.palette) throw new Error('Indexed PNG is missing PLTE');
  const index = readPackedSample(line, x, metadata.bitDepth);
  const paletteOffset = index * 3;
  if (paletteOffset + 2 >= metadata.palette.length)
    throw new Error('Indexed PNG palette is invalid');
  return [
    metadata.palette[paletteOffset]!,
    metadata.palette[paletteOffset + 1]!,
    metadata.palette[paletteOffset + 2]!,
    metadata.transparency?.[index] ?? 255,
  ];
}

function readPackedGrayscalePixel(
  line: Buffer,
  x: number,
  metadata: PngMetadata,
): [number, number, number, number] {
  const sample = readPackedSample(line, x, metadata.bitDepth);
  const max = (1 << metadata.bitDepth) - 1;
  const gray = Math.round((sample / max) * 255);
  const transparent =
    metadata.transparency && metadata.transparency.length >= 2
      ? sample === metadata.transparency.readUInt16BE(0)
      : false;
  return [gray, gray, gray, transparent ? 0 : 255];
}

function readPackedSample(line: Buffer, x: number, bitDepth: number): number {
  const bitOffset = x * bitDepth;
  const byte = line[Math.floor(bitOffset / 8)]!;
  const shift = 8 - bitDepth - (bitOffset % 8);
  return (byte >> shift) & ((1 << bitDepth) - 1);
}

function scanlineByteLength(metadata: PngMetadata): number {
  const channels = COLOR_CHANNELS.get(metadata.colorType)!;
  return Math.ceil((metadata.width * channels * metadata.bitDepth) / 8);
}

function filterBytesPerPixel(metadata: PngMetadata): number {
  const channels = COLOR_CHANNELS.get(metadata.colorType)!;
  return Math.max(1, Math.ceil((channels * metadata.bitDepth) / 8));
}

function matchesTransparentGray(sample: number, metadata: PngMetadata): boolean {
  if (!metadata.transparency || metadata.transparency.length < 2) return false;
  return sample === metadata.transparency.readUInt16BE(0);
}

function matchesTransparentRgb(
  red: number,
  green: number,
  blue: number,
  metadata: PngMetadata,
): boolean {
  if (!metadata.transparency || metadata.transparency.length < 6) return false;
  return (
    red === metadata.transparency.readUInt16BE(0) &&
    green === metadata.transparency.readUInt16BE(2) &&
    blue === metadata.transparency.readUInt16BE(4)
  );
}

function encodeChunk(type: string, data: Buffer): Buffer {
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

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  return upDistance <= upLeftDistance ? up : upLeft;
}

function validateDimension(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`PNG ${label} must be positive`);
  return value;
}
