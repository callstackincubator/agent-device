import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const srcDir = path.join(root, "src");
const manifestPath = path.join(srcDir, "content", "assets.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const supported = new Set([".png", ".svg", ".webp"]);

function readPngSize(buffer) {
  if (buffer.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("Invalid PNG signature");
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readWebpSize(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error("Invalid WebP signature");
  }

  const type = buffer.toString("ascii", 12, 16);

  if (type === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }

  if (type === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  if (type === "VP8 ") {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  throw new Error(`Unsupported WebP chunk ${type}`);
}

function readSvgSize(buffer) {
  const source = buffer.toString("utf8");
  const svg = source.match(/<svg\b[^>]*>/i)?.[0];

  if (!svg) {
    throw new Error("Invalid SVG");
  }

  const width = Number(svg.match(/\bwidth="([0-9.]+)"/i)?.[1]);
  const height = Number(svg.match(/\bheight="([0-9.]+)"/i)?.[1]);

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("SVG missing numeric width/height");
  }

  return { height, vector: true, width };
}

function imageSize(filePath) {
  const buffer = readFileSync(filePath);
  const ext = path.extname(filePath);

  if (ext === ".png") {
    return readPngSize(buffer);
  }

  if (ext === ".webp") {
    return readWebpSize(buffer);
  }

  if (ext === ".svg") {
    return readSvgSize(buffer);
  }

  throw new Error(`Unsupported asset type ${ext}`);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(next) : [next];
  });
}

function sourceText() {
  return walk(srcDir)
    .filter((file) => [".ts", ".tsx", ".json", ".css"].includes(path.extname(file)))
    .filter((file) => file !== manifestPath)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

const failures = [];
const references = sourceText();
const manifestPaths = new Set(manifest.map((entry) => entry.path));
const figmaAssets = walk(path.join(publicDir, "figma"))
  .filter((file) => supported.has(path.extname(file)))
  .map((file) => `/${path.relative(publicDir, file)}`);

for (const assetPath of figmaAssets) {
  if (!manifestPaths.has(assetPath)) {
    failures.push(`${assetPath} is missing from src/content/assets.json`);
  }
}

for (const entry of manifest) {
  const filePath = path.join(publicDir, entry.path);

  try {
    const { width, height, vector = false } = imageSize(filePath);
    const { size } = statSync(filePath);
    const minWidth = vector ? entry.logicalWidth : entry.logicalWidth * entry.density;
    const minHeight = vector ? entry.logicalHeight : entry.logicalHeight * entry.density;

    if (!vector && entry.density < 2) {
      failures.push(`${entry.path} has ${entry.density}x density, expected at least 2x`);
    }

    if (width < minWidth || height < minHeight) {
      failures.push(
        `${entry.path} is ${width}x${height}, expected at least ${minWidth}x${minHeight}`,
      );
    }

    if (size > entry.maxBytes) {
      failures.push(`${entry.path} is ${size} bytes, max is ${entry.maxBytes}`);
    }

    if (!references.includes(entry.path)) {
      failures.push(`${entry.path} is not referenced from src`);
    }
  } catch (error) {
    failures.push(`${entry.path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`Asset audit passed for ${manifest.length} assets.`);
