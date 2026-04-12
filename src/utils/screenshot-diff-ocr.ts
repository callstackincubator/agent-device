import type { Rect } from './snapshot.ts';
import { runCmd, whichCmd } from './exec.ts';

export type ScreenshotOcrBlock = {
  text: string;
  confidence: number;
  rect: Rect;
  normalizedRect: Rect;
};

export type ScreenshotOcrTextMatch = {
  text: string;
  baselineRect: Rect;
  currentRect: Rect;
  delta: { x: number; y: number; width: number; height: number };
  confidence: number;
  possibleTextMetricMismatch: boolean;
};

export type ScreenshotOcrSummary = {
  provider: 'tesseract';
  baselineBlocks: number;
  currentBlocks: number;
  matches: ScreenshotOcrTextMatch[];
};

export type ScreenshotOcrAnalysis = ScreenshotOcrSummary & {
  baselineBlocksRaw: ScreenshotOcrBlock[];
  currentBlocksRaw: ScreenshotOcrBlock[];
};

type TesseractWord = {
  key: string;
  text: string;
  confidence: number;
  rect: Rect;
};

const OCR_TIMEOUT_MS = 10_000;
const MAX_OCR_MATCHES = 12;
// OCR text matching uses small generic movement/shape thresholds; the fixed gap
// is only a floor before falling back to word-height-relative spacing.
const MIN_MEANINGFUL_DELTA_PX = 2;
const MIN_SEGMENT_GAP_PX = 48;
const TEXT_WIDTH_MISMATCH_RATIO = 0.08;
const TEXT_HEIGHT_MISMATCH_RATIO = 0.12;

export async function summarizeScreenshotOcr(params: {
  baselinePath: string;
  currentPath: string;
  width: number;
  height: number;
}): Promise<ScreenshotOcrAnalysis | undefined> {
  if (!(await whichCmd('tesseract'))) return undefined;

  try {
    const [baselineResult, currentResult] = await Promise.all([
      runTesseractTsv(params.baselinePath),
      runTesseractTsv(params.currentPath),
    ]);
    if (baselineResult.exitCode !== 0 || currentResult.exitCode !== 0) return undefined;

    const baselineBlocks = parseTesseractTsv(baselineResult.stdout, params.width, params.height);
    const currentBlocks = parseTesseractTsv(currentResult.stdout, params.width, params.height);
    const matches = matchOcrBlocks(baselineBlocks, currentBlocks);
    if (baselineBlocks.length === 0 && currentBlocks.length === 0) return undefined;

    return {
      provider: 'tesseract',
      baselineBlocks: baselineBlocks.length,
      currentBlocks: currentBlocks.length,
      baselineBlocksRaw: baselineBlocks,
      currentBlocksRaw: currentBlocks,
      matches,
    };
  } catch {
    return undefined;
  }
}

export function toScreenshotOcrSummary(analysis: ScreenshotOcrAnalysis): ScreenshotOcrSummary {
  return {
    provider: analysis.provider,
    baselineBlocks: analysis.baselineBlocks,
    currentBlocks: analysis.currentBlocks,
    matches: analysis.matches,
  };
}

export function parseTesseractTsv(
  tsv: string,
  imageWidth: number,
  imageHeight: number,
): ScreenshotOcrBlock[] {
  const [headerLine, ...lines] = tsv.split(/\r?\n/);
  if (!headerLine) return [];

  const headers = headerLine.split('\t');
  const indexByName = new Map(headers.map((header, index) => [header, index]));
  const words: TesseractWord[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const values = line.split('\t');
    const level = readTsvNumber(values, indexByName, 'level');
    const rawText = readTsvString(values, indexByName, 'text').trim();
    const confidence = readTsvNumber(values, indexByName, 'conf');
    // Tesseract TSV uses level=5 for word rows; higher-level rows are page/block/line containers.
    if (level !== 5 || !isMeaningfulText(rawText) || confidence < 0) continue;

    const left = readTsvNumber(values, indexByName, 'left');
    const top = readTsvNumber(values, indexByName, 'top');
    const width = readTsvNumber(values, indexByName, 'width');
    const height = readTsvNumber(values, indexByName, 'height');
    if (width <= 0 || height <= 0) continue;

    words.push({
      key: [
        readTsvString(values, indexByName, 'page_num'),
        readTsvString(values, indexByName, 'block_num'),
        readTsvString(values, indexByName, 'par_num'),
        readTsvString(values, indexByName, 'line_num'),
      ].join(':'),
      text: rawText,
      confidence,
      rect: { x: left, y: top, width, height },
    });
  }

  const wordsByLine = new Map<string, TesseractWord[]>();
  for (const word of words) {
    const existing = wordsByLine.get(word.key);
    if (existing) existing.push(word);
    else wordsByLine.set(word.key, [word]);
  }

  return Array.from(wordsByLine.values())
    .flatMap((lineWords) => splitLineWordsIntoSegments(lineWords))
    .map((segmentWords) => toOcrBlock(segmentWords, imageWidth, imageHeight))
    .filter((block): block is ScreenshotOcrBlock => block !== null);
}

export function matchOcrBlocks(
  baselineBlocks: ScreenshotOcrBlock[],
  currentBlocks: ScreenshotOcrBlock[],
): ScreenshotOcrTextMatch[] {
  const usedCurrent = new Set<number>();
  const matches: ScreenshotOcrTextMatch[] = [];

  for (const baselineBlock of baselineBlocks) {
    const normalizedText = normalizeTextForMatching(baselineBlock.text);
    const currentIndex = findBestCurrentMatch(
      baselineBlock,
      normalizedText,
      currentBlocks,
      usedCurrent,
    );
    if (currentIndex === null) continue;
    usedCurrent.add(currentIndex);

    const currentBlock = currentBlocks[currentIndex]!;
    const match = toOcrTextMatch(baselineBlock, currentBlock);
    if (!hasMeaningfulOcrDelta(match)) continue;
    matches.push(match);
  }

  return matches
    .sort((left, right) => scoreOcrMatch(right) - scoreOcrMatch(left))
    .slice(0, MAX_OCR_MATCHES);
}

function runTesseractTsv(imagePath: string): ReturnType<typeof runCmd> {
  return runCmd('tesseract', [imagePath, 'stdout', '-l', 'eng', 'tsv'], {
    allowFailure: true,
    timeoutMs: OCR_TIMEOUT_MS,
  });
}

function toOcrBlock(
  words: TesseractWord[],
  imageWidth: number,
  imageHeight: number,
): ScreenshotOcrBlock | null {
  if (words.length === 0) return null;
  const sortedWords = [...words].sort((left, right) => left.rect.x - right.rect.x);
  const rect = unionRects(sortedWords.map((word) => word.rect));
  const confidence = Math.round(average(sortedWords.map((word) => word.confidence)) * 100) / 100;
  return {
    text: sortedWords.map((word) => word.text).join(' '),
    confidence,
    rect,
    normalizedRect: {
      x: roundPercentage(rect.x / imageWidth),
      y: roundPercentage(rect.y / imageHeight),
      width: roundPercentage(rect.width / imageWidth),
      height: roundPercentage(rect.height / imageHeight),
    },
  };
}

function splitLineWordsIntoSegments(words: TesseractWord[]): TesseractWord[][] {
  const sortedWords = [...words].sort((left, right) => left.rect.x - right.rect.x);
  const segments: TesseractWord[][] = [];
  let currentSegment: TesseractWord[] = [];
  for (const word of sortedWords) {
    const previousWord = currentSegment.at(-1);
    if (!previousWord) {
      currentSegment.push(word);
      continue;
    }

    const gap = word.rect.x - (previousWord.rect.x + previousWord.rect.width);
    const height = Math.max(previousWord.rect.height, word.rect.height);
    if (gap > Math.max(MIN_SEGMENT_GAP_PX, height * 2.5)) {
      segments.push(currentSegment);
      currentSegment = [word];
      continue;
    }
    currentSegment.push(word);
  }
  if (currentSegment.length > 0) segments.push(currentSegment);
  return segments;
}

function findBestCurrentMatch(
  baselineBlock: ScreenshotOcrBlock,
  normalizedText: string,
  currentBlocks: ScreenshotOcrBlock[],
  usedCurrent: Set<number>,
): number | null {
  let bestIndex: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < currentBlocks.length; index += 1) {
    if (usedCurrent.has(index)) continue;
    const currentBlock = currentBlocks[index]!;
    if (normalizeTextForMatching(currentBlock.text) !== normalizedText) continue;
    const distance = squaredDistance(
      rectCenter(baselineBlock.normalizedRect),
      rectCenter(currentBlock.normalizedRect),
    );
    if (distance >= bestDistance) continue;
    bestIndex = index;
    bestDistance = distance;
  }
  return bestIndex;
}

function toOcrTextMatch(
  baselineBlock: ScreenshotOcrBlock,
  currentBlock: ScreenshotOcrBlock,
): ScreenshotOcrTextMatch {
  const delta = {
    x: currentBlock.rect.x - baselineBlock.rect.x,
    y: currentBlock.rect.y - baselineBlock.rect.y,
    width: currentBlock.rect.width - baselineBlock.rect.width,
    height: currentBlock.rect.height - baselineBlock.rect.height,
  };
  const widthRatio = roundRatio(currentBlock.rect.width / baselineBlock.rect.width);
  const heightRatio = roundRatio(currentBlock.rect.height / baselineBlock.rect.height);
  const possibleTextMetricMismatch =
    Math.abs(widthRatio - 1) >= TEXT_WIDTH_MISMATCH_RATIO ||
    Math.abs(heightRatio - 1) >= TEXT_HEIGHT_MISMATCH_RATIO;
  return {
    text: baselineBlock.text,
    baselineRect: baselineBlock.rect,
    currentRect: currentBlock.rect,
    delta,
    confidence: Math.round(Math.min(baselineBlock.confidence, currentBlock.confidence) * 100) / 100,
    possibleTextMetricMismatch,
  };
}

function hasMeaningfulOcrDelta(match: ScreenshotOcrTextMatch): boolean {
  return (
    Math.abs(match.delta.x) >= MIN_MEANINGFUL_DELTA_PX ||
    Math.abs(match.delta.y) >= MIN_MEANINGFUL_DELTA_PX ||
    Math.abs(match.delta.width) >= MIN_MEANINGFUL_DELTA_PX ||
    Math.abs(match.delta.height) >= MIN_MEANINGFUL_DELTA_PX ||
    match.possibleTextMetricMismatch
  );
}

function scoreOcrMatch(match: ScreenshotOcrTextMatch): number {
  return (
    Math.abs(match.delta.x) +
    Math.abs(match.delta.y) +
    Math.abs(match.delta.width) +
    Math.abs(match.delta.height) +
    (match.possibleTextMetricMismatch ? 25 : 0)
  );
}

function unionRects(rects: Rect[]): Rect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function rectCenter(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function squaredDistance(left: { x: number; y: number }, right: { x: number; y: number }): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}

function readTsvString(values: string[], indexByName: Map<string, number>, name: string): string {
  const index = indexByName.get(name);
  return index === undefined ? '' : (values[index] ?? '');
}

function readTsvNumber(values: string[], indexByName: Map<string, number>, name: string): number {
  const value = Number(readTsvString(values, indexByName, name));
  return Number.isFinite(value) ? value : 0;
}

function isMeaningfulText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

function normalizeTextForMatching(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundPercentage(ratio: number): number {
  return Math.round(ratio * 100 * 100) / 100;
}

function roundRatio(ratio: number): number {
  return Math.round(ratio * 1000) / 1000;
}
