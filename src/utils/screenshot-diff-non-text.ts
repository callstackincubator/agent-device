import type { Rect } from './snapshot.ts';
import type { ScreenshotOcrAnalysis, ScreenshotOcrBlock } from './screenshot-diff-ocr.ts';
import type { ScreenshotDiffRegion } from './screenshot-diff-regions.ts';

export type ScreenshotNonTextDelta = {
  index: number;
  regionIndex?: number;
  slot: 'leading' | 'trailing' | 'background' | 'separator' | 'unknown';
  likelyKind: 'icon' | 'toggle' | 'chevron' | 'separator' | 'card-or-background' | 'visual';
  rect: Rect;
  nearestText?: string;
};

const MAX_NON_TEXT_DELTAS = 12;
const OCR_MASK_PADDING_PX = 8;
const MIN_COMPONENT_PIXELS = 24;
const MIN_COMPONENT_SIDE = 3;
const MERGE_GAP_PX = 10;
const MIN_CONTENT_Y_RATIO = 0.08;
const KIND_SCORE = {
  icon: 90,
  toggle: 90,
  chevron: 75,
  separator: 45,
  visual: 35,
  'card-or-background': 10,
} satisfies Record<ScreenshotNonTextDelta['likelyKind'], number>;
const SLOT_SCORE = {
  leading: 20,
  trailing: 20,
  separator: 10,
  unknown: 0,
  background: -30,
} satisfies Record<ScreenshotNonTextDelta['slot'], number>;

type MutableComponent = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  differentPixels: number;
};

type ScoredNonTextDelta = Omit<ScreenshotNonTextDelta, 'index'> & {
  score: number;
};

export function summarizeNonTextDiffDeltas(params: {
  diffMask: Uint8Array;
  width: number;
  height: number;
  regions: ScreenshotDiffRegion[];
  ocr?: ScreenshotOcrAnalysis;
  maxDeltas?: number;
}): ScreenshotNonTextDelta[] {
  const maskedDiff = maskOcrText(params.diffMask, params.width, params.height, params.ocr);
  const rawComponents = findConnectedComponents(maskedDiff, params.width, params.height);
  const mergedComponents = mergeNearbyComponents(rawComponents, MERGE_GAP_PX);
  const textBlocks = getOcrBlocks(params.ocr);
  return (
    mergedComponents
      .filter(hasUsefulComponentSize)
      .map((component) => toNonTextDelta(component, params, textBlocks))
      // Status bars and top chrome tend to produce noisy residuals around time,
      // signal, and battery text; changed regions still report that area.
      .filter((delta) => delta.rect.y >= params.height * MIN_CONTENT_Y_RATIO)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(0, params.maxDeltas ?? MAX_NON_TEXT_DELTAS))
      .map((delta, index) => toPublicNonTextDelta(delta, index + 1))
  );
}

function maskOcrText(
  diffMask: Uint8Array,
  width: number,
  height: number,
  ocr: ScreenshotOcrAnalysis | undefined,
): Uint8Array {
  const maskedDiff = new Uint8Array(diffMask);
  if (!ocr) return maskedDiff;
  for (const block of [...ocr.baselineBlocksRaw, ...ocr.currentBlocksRaw]) {
    clearRect(maskedDiff, width, height, expandRect(block.rect, OCR_MASK_PADDING_PX));
  }
  return maskedDiff;
}

function findConnectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): MutableComponent[] {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const components: MutableComponent[] = [];
  for (let pixelIndex = 0; pixelIndex < mask.length; pixelIndex += 1) {
    if (mask[pixelIndex] !== 1 || visited[pixelIndex] === 1) continue;
    let queueStart = 0;
    let queueEnd = 0;
    queue[queueEnd] = pixelIndex;
    queueEnd += 1;
    visited[pixelIndex] = 1;

    const startX = pixelIndex % width;
    const startY = Math.floor(pixelIndex / width);
    const component: MutableComponent = {
      minX: startX,
      minY: startY,
      maxX: startX,
      maxY: startY,
      differentPixels: 0,
    };

    while (queueStart < queueEnd) {
      const currentIndex = queue[queueStart]!;
      queueStart += 1;
      const x = currentIndex % width;
      const y = Math.floor(currentIndex / width);
      component.minX = Math.min(component.minX, x);
      component.minY = Math.min(component.minY, y);
      component.maxX = Math.max(component.maxX, x);
      component.maxY = Math.max(component.maxY, y);
      component.differentPixels += 1;

      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        const neighborY = y + yOffset;
        if (neighborY < 0 || neighborY >= height) continue;
        for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
          if (xOffset === 0 && yOffset === 0) continue;
          const neighborX = x + xOffset;
          if (neighborX < 0 || neighborX >= width) continue;
          const neighborIndex = neighborY * width + neighborX;
          if (mask[neighborIndex] !== 1 || visited[neighborIndex] === 1) continue;
          visited[neighborIndex] = 1;
          queue[queueEnd] = neighborIndex;
          queueEnd += 1;
        }
      }
    }
    components.push(component);
  }
  return components;
}

function mergeNearbyComponents(components: MutableComponent[], gapPx: number): MutableComponent[] {
  const merged: MutableComponent[] = [];
  for (const component of components.sort(
    (left, right) => left.minY - right.minY || left.minX - right.minX,
  )) {
    const existing = merged.find((candidate) => componentsAreNear(candidate, component, gapPx));
    if (!existing) {
      merged.push({ ...component });
      continue;
    }
    existing.minX = Math.min(existing.minX, component.minX);
    existing.minY = Math.min(existing.minY, component.minY);
    existing.maxX = Math.max(existing.maxX, component.maxX);
    existing.maxY = Math.max(existing.maxY, component.maxY);
    existing.differentPixels += component.differentPixels;
  }
  return merged;
}

function toNonTextDelta(
  component: MutableComponent,
  params: {
    width: number;
    height: number;
    regions: ScreenshotDiffRegion[];
  },
  textBlocks: ScreenshotOcrBlock[],
): ScoredNonTextDelta {
  const rect = componentToRect(component);
  const regionIndex = findContainingRegionIndex(rect, params.regions);
  const nearestText = findNearestText(rect, textBlocks);
  const slot = classifySlot(rect, nearestText?.block.rect, params.width);
  const likelyKind = classifyLikelyKind(rect, slot, component.differentPixels);
  const scoreParams = {
    ...(regionIndex ? { regionIndex } : {}),
    slot,
    likelyKind,
    rect,
  };
  return {
    ...(regionIndex ? { regionIndex } : {}),
    slot,
    likelyKind,
    rect,
    ...(nearestText ? { nearestText: nearestText.block.text } : {}),
    score: scoreNonTextDelta(scoreParams, component.differentPixels),
  };
}

function toPublicNonTextDelta(delta: ScoredNonTextDelta, index: number): ScreenshotNonTextDelta {
  return {
    index,
    ...(delta.regionIndex ? { regionIndex: delta.regionIndex } : {}),
    slot: delta.slot,
    likelyKind: delta.likelyKind,
    rect: delta.rect,
    ...(delta.nearestText ? { nearestText: delta.nearestText } : {}),
  };
}

function classifySlot(
  rect: Rect,
  nearestTextRect: Rect | undefined,
  imageWidth: number,
): ScreenshotNonTextDelta['slot'] {
  if (rect.height <= 3 && rect.width >= 60) return 'separator';
  if (!nearestTextRect) {
    if (rect.width >= imageWidth * 0.4) return 'background';
    return 'unknown';
  }
  if (rect.width >= imageWidth * 0.4) return 'background';
  const rectCenterX = rect.x + rect.width / 2;
  const textCenterX = nearestTextRect.x + nearestTextRect.width / 2;
  if (rectCenterX < textCenterX - nearestTextRect.width / 2) return 'leading';
  if (rectCenterX > textCenterX + nearestTextRect.width / 2) return 'trailing';
  return rect.width >= imageWidth * 0.35 ? 'background' : 'unknown';
}

function classifyLikelyKind(
  rect: Rect,
  slot: ScreenshotNonTextDelta['slot'],
  differentPixels: number,
): ScreenshotNonTextDelta['likelyKind'] {
  const aspect = rect.width / rect.height;
  const density = differentPixels / (rect.width * rect.height);
  if (slot === 'separator') return 'separator';
  if (slot === 'background') return 'card-or-background';
  if (slot === 'trailing' && aspect >= 1.5 && aspect <= 3.8 && density >= 0.35) return 'toggle';
  if (slot === 'trailing' && rect.width <= 44 && rect.height <= 64) return 'chevron';
  if (slot === 'leading' && aspect >= 0.55 && aspect <= 1.8) return 'icon';
  if (rect.width >= 300 || rect.height >= 160) return 'card-or-background';
  return 'visual';
}

function scoreNonTextDelta(
  delta: {
    regionIndex?: number;
    slot: ScreenshotNonTextDelta['slot'];
    likelyKind: ScreenshotNonTextDelta['likelyKind'];
    rect: Rect;
  },
  differentPixels: number,
): number {
  const sizePenalty = delta.rect.width >= 300 || delta.rect.height >= 160 ? -35 : 0;
  const regionScore = delta.regionIndex ? 20 : 0;
  return (
    KIND_SCORE[delta.likelyKind] +
    SLOT_SCORE[delta.slot] +
    regionScore +
    sizePenalty +
    Math.min(20, differentPixels / 200)
  );
}

function findContainingRegionIndex(
  rect: Rect,
  regions: ScreenshotDiffRegion[],
): number | undefined {
  let bestRegion: ScreenshotDiffRegion | undefined;
  let bestOverlap = 0;
  for (const region of regions) {
    const overlap = intersectArea(rect, region.rect);
    if (overlap <= bestOverlap) continue;
    bestOverlap = overlap;
    bestRegion = region;
  }
  return bestRegion?.index;
}

function findNearestText(
  rect: Rect,
  textBlocks: ScreenshotOcrBlock[],
): { block: ScreenshotOcrBlock; distance: number } | undefined {
  let nearest: { block: ScreenshotOcrBlock; distance: number } | undefined;
  const center = rectCenter(rect);
  for (const block of textBlocks) {
    const distance = Math.sqrt(squaredDistance(center, rectCenter(block.rect)));
    if (nearest && distance >= nearest.distance) continue;
    nearest = { block, distance };
  }
  return nearest;
}

function getOcrBlocks(ocr: ScreenshotOcrAnalysis | undefined): ScreenshotOcrBlock[] {
  return ocr ? [...ocr.baselineBlocksRaw, ...ocr.currentBlocksRaw] : [];
}

function hasUsefulComponentSize(component: MutableComponent): boolean {
  const rect = componentToRect(component);
  return (
    component.differentPixels >= MIN_COMPONENT_PIXELS &&
    rect.width >= MIN_COMPONENT_SIDE &&
    rect.height >= MIN_COMPONENT_SIDE
  );
}

function componentToRect(component: MutableComponent): Rect {
  return {
    x: component.minX,
    y: component.minY,
    width: component.maxX - component.minX + 1,
    height: component.maxY - component.minY + 1,
  };
}

function expandRect(rect: Rect, padding: number): Rect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

function clearRect(mask: Uint8Array, width: number, height: number, rect: Rect): void {
  const minX = clamp(Math.floor(rect.x), 0, width - 1);
  const minY = clamp(Math.floor(rect.y), 0, height - 1);
  const maxX = clamp(Math.ceil(rect.x + rect.width), 0, width);
  const maxY = clamp(Math.ceil(rect.y + rect.height), 0, height);
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      mask[y * width + x] = 0;
    }
  }
}

function componentsAreNear(
  left: MutableComponent,
  right: MutableComponent,
  gapPx: number,
): boolean {
  return (
    left.minX - gapPx <= right.maxX &&
    right.minX - gapPx <= left.maxX &&
    left.minY - gapPx <= right.maxY &&
    right.minY - gapPx <= left.maxY
  );
}

function intersectArea(left: Rect, right: Rect): number {
  const minX = Math.max(left.x, right.x);
  const minY = Math.max(left.y, right.y);
  const maxX = Math.min(left.x + left.width, right.x + right.width);
  const maxY = Math.min(left.y + left.height, right.y + right.height);
  if (maxX <= minX || maxY <= minY) return 0;
  return (maxX - minX) * (maxY - minY);
}

function rectCenter(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function squaredDistance(left: { x: number; y: number }, right: { x: number; y: number }): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
