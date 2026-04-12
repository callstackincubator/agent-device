import { PNG } from 'pngjs';
import { splitLargeDiffRegions } from './screenshot-diff-region-split.ts';

export type ScreenshotDiffColor = {
  r: number;
  g: number;
  b: number;
};

export type ScreenshotDiffRegion = {
  index: number;
  rect: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  normalizedRect: { x: number; y: number; width: number; height: number };
  differentPixels: number;
  shareOfDiffPercentage: number;
  imagePercentage: number;
  densityPercentage: number;
  shape: 'compact' | 'horizontal-band' | 'vertical-band' | 'large-area';
  size: 'small' | 'medium' | 'large';
  location: string;
  averageBaselineColor: ScreenshotDiffColor;
  averageCurrentColor: ScreenshotDiffColor;
  averageBaselineColorHex: string;
  averageCurrentColorHex: string;
  baselineLuminance: number;
  currentLuminance: number;
  dominantChange: 'brighter' | 'darker' | 'color-shift' | 'mixed';
  description: string;
  currentOverlayMatches?: ScreenshotDiffRegionOverlayMatch[];
};

export type ScreenshotDiffRegionOverlayMatch = {
  ref: string;
  label?: string;
  overlapPercentage: number;
  regionCoveragePercentage: number;
  rect: { x: number; y: number; width: number; height: number };
};

const DEFAULT_MAX_DIFF_REGIONS = 8;
const REGION_MERGE_GAP_PX = 12;

export type MutableDiffRegion = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  differentPixels: number;
  baselineRed: number;
  baselineGreen: number;
  baselineBlue: number;
  currentRed: number;
  currentGreen: number;
  currentBlue: number;
};

export function summarizeDiffRegions(params: {
  diffMask: Uint8Array;
  baseline: PNG;
  current: PNG;
  totalPixels: number;
  differentPixels: number;
  maxRegions?: number;
}): ScreenshotDiffRegion[] {
  const rawRegions = findConnectedDiffRegions(params);
  // Avoid quadratic nearby-merge work on extremely noisy diffs; the later ranking
  // still keeps the largest components, but tiny speckles may remain unmerged.
  const mergedRegions =
    rawRegions.length <= 2000 ? mergeNearbyRegions(rawRegions, REGION_MERGE_GAP_PX) : rawRegions;
  const splitRegions = splitLargeDiffRegions(mergedRegions, params);
  return splitRegions
    .sort((left, right) => {
      const pixelDelta = right.differentPixels - left.differentPixels;
      if (pixelDelta !== 0) return pixelDelta;
      const topDelta = left.minY - right.minY;
      if (topDelta !== 0) return topDelta;
      return left.minX - right.minX;
    })
    .slice(0, Math.max(0, params.maxRegions ?? DEFAULT_MAX_DIFF_REGIONS))
    .map((region, index) =>
      toScreenshotDiffRegion(region, index + 1, {
        width: params.baseline.width,
        height: params.baseline.height,
        totalPixels: params.totalPixels,
        differentPixels: params.differentPixels,
      }),
    );
}

function findConnectedDiffRegions(params: {
  diffMask: Uint8Array;
  baseline: PNG;
  current: PNG;
}): MutableDiffRegion[] {
  const { diffMask, baseline, current } = params;
  const { width, height } = baseline;
  const visited = new Uint8Array(diffMask.length);
  const queue = new Int32Array(diffMask.length);
  const regions: MutableDiffRegion[] = [];

  for (let pixelIndex = 0; pixelIndex < diffMask.length; pixelIndex += 1) {
    if (diffMask[pixelIndex] !== 1 || visited[pixelIndex] === 1) continue;

    let queueStart = 0;
    let queueEnd = 0;
    queue[queueEnd] = pixelIndex;
    queueEnd += 1;
    visited[pixelIndex] = 1;

    const startX = pixelIndex % width;
    const startY = Math.floor(pixelIndex / width);
    const region: MutableDiffRegion = {
      minX: startX,
      minY: startY,
      maxX: startX,
      maxY: startY,
      differentPixels: 0,
      baselineRed: 0,
      baselineGreen: 0,
      baselineBlue: 0,
      currentRed: 0,
      currentGreen: 0,
      currentBlue: 0,
    };

    while (queueStart < queueEnd) {
      const currentPixelIndex = queue[queueStart]!;
      queueStart += 1;
      addPixelToRegion(region, currentPixelIndex, width, baseline, current);

      const x = currentPixelIndex % width;
      const y = Math.floor(currentPixelIndex / width);
      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        const neighborY = y + yOffset;
        if (neighborY < 0 || neighborY >= height) continue;
        for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
          if (xOffset === 0 && yOffset === 0) continue;
          const neighborX = x + xOffset;
          if (neighborX < 0 || neighborX >= width) continue;
          const neighborIndex = neighborY * width + neighborX;
          if (diffMask[neighborIndex] !== 1 || visited[neighborIndex] === 1) continue;
          visited[neighborIndex] = 1;
          queue[queueEnd] = neighborIndex;
          queueEnd += 1;
        }
      }
    }

    regions.push(region);
  }

  return regions;
}

function addPixelToRegion(
  region: MutableDiffRegion,
  pixelIndex: number,
  width: number,
  baseline: PNG,
  current: PNG,
): void {
  const x = pixelIndex % width;
  const y = Math.floor(pixelIndex / width);
  const dataIndex = pixelIndex * 4;
  region.minX = Math.min(region.minX, x);
  region.minY = Math.min(region.minY, y);
  region.maxX = Math.max(region.maxX, x);
  region.maxY = Math.max(region.maxY, y);
  region.differentPixels += 1;
  region.baselineRed += baseline.data[dataIndex]!;
  region.baselineGreen += baseline.data[dataIndex + 1]!;
  region.baselineBlue += baseline.data[dataIndex + 2]!;
  region.currentRed += current.data[dataIndex]!;
  region.currentGreen += current.data[dataIndex + 1]!;
  region.currentBlue += current.data[dataIndex + 2]!;
}

function mergeNearbyRegions(regions: MutableDiffRegion[], gapPx: number): MutableDiffRegion[] {
  const merged: MutableDiffRegion[] = [];
  for (const region of regions.sort((left, right) => {
    const topDelta = left.minY - right.minY;
    if (topDelta !== 0) return topDelta;
    return left.minX - right.minX;
  })) {
    const existing = merged.find((candidate) => regionsAreNear(candidate, region, gapPx));
    if (!existing) {
      merged.push({ ...region });
      continue;
    }
    mergeRegionInto(existing, region);
  }
  return merged;
}

function regionsAreNear(left: MutableDiffRegion, right: MutableDiffRegion, gapPx: number): boolean {
  return (
    left.minX - gapPx <= right.maxX &&
    right.minX - gapPx <= left.maxX &&
    left.minY - gapPx <= right.maxY &&
    right.minY - gapPx <= left.maxY
  );
}

function mergeRegionInto(target: MutableDiffRegion, source: MutableDiffRegion): void {
  target.minX = Math.min(target.minX, source.minX);
  target.minY = Math.min(target.minY, source.minY);
  target.maxX = Math.max(target.maxX, source.maxX);
  target.maxY = Math.max(target.maxY, source.maxY);
  target.differentPixels += source.differentPixels;
  target.baselineRed += source.baselineRed;
  target.baselineGreen += source.baselineGreen;
  target.baselineBlue += source.baselineBlue;
  target.currentRed += source.currentRed;
  target.currentGreen += source.currentGreen;
  target.currentBlue += source.currentBlue;
}

function toScreenshotDiffRegion(
  region: MutableDiffRegion,
  index: number,
  image: { width: number; height: number; totalPixels: number; differentPixels: number },
): ScreenshotDiffRegion {
  const rect = {
    x: region.minX,
    y: region.minY,
    width: region.maxX - region.minX + 1,
    height: region.maxY - region.minY + 1,
  };
  const center = {
    x: Math.round(region.minX + rect.width / 2),
    y: Math.round(region.minY + rect.height / 2),
  };
  const averageBaselineColor = averageRegionColor(
    region.baselineRed,
    region.baselineGreen,
    region.baselineBlue,
    region.differentPixels,
  );
  const averageCurrentColor = averageRegionColor(
    region.currentRed,
    region.currentGreen,
    region.currentBlue,
    region.differentPixels,
  );
  const regionArea = rect.width * rect.height;
  const densityPercentage = roundPercentage(region.differentPixels / regionArea);
  const baselineLuminance = Math.round(luminance(averageBaselineColor));
  const currentLuminance = Math.round(luminance(averageCurrentColor));
  const shape = describeRegionShape(rect, image.width, image.height);
  const size = describeRegionSize(regionArea, image.totalPixels);
  const dominantChange = describeDominantChange(averageBaselineColor, averageCurrentColor);
  const location = describeRegionLocation(center, image.width, image.height);
  return {
    index,
    rect,
    center,
    normalizedRect: {
      x: roundPercentage(rect.x / image.width),
      y: roundPercentage(rect.y / image.height),
      width: roundPercentage(rect.width / image.width),
      height: roundPercentage(rect.height / image.height),
    },
    differentPixels: region.differentPixels,
    shareOfDiffPercentage: roundPercentage(region.differentPixels / image.differentPixels),
    imagePercentage: roundPercentage(region.differentPixels / image.totalPixels),
    densityPercentage,
    shape,
    size,
    location,
    averageBaselineColor,
    averageCurrentColor,
    averageBaselineColorHex: toHexColor(averageBaselineColor),
    averageCurrentColorHex: toHexColor(averageCurrentColor),
    baselineLuminance,
    currentLuminance,
    dominantChange,
    description:
      `${size} region (${shape}) in the ${location}; ` +
      `${densityPercentage}% of this region's pixels differ; ` +
      `current is ${formatDominantChange(dominantChange)}.`,
  };
}

function averageRegionColor(
  red: number,
  green: number,
  blue: number,
  pixels: number,
): ScreenshotDiffColor {
  return {
    r: Math.round(red / pixels),
    g: Math.round(green / pixels),
    b: Math.round(blue / pixels),
  };
}

function describeRegionLocation(
  center: { x: number; y: number },
  width: number,
  height: number,
): string {
  const horizontal =
    center.x < width / 3 ? 'left' : center.x > (width * 2) / 3 ? 'right' : 'center';
  const vertical =
    center.y < height / 3 ? 'top' : center.y > (height * 2) / 3 ? 'bottom' : 'middle';
  return horizontal === 'center' && vertical === 'middle' ? 'center' : `${vertical}-${horizontal}`;
}

function describeDominantChange(
  baseline: ScreenshotDiffColor,
  current: ScreenshotDiffColor,
): ScreenshotDiffRegion['dominantChange'] {
  const baselineLuminance = luminance(baseline);
  const currentLuminance = luminance(current);
  const luminanceDelta = currentLuminance - baselineLuminance;
  if (Math.abs(luminanceDelta) >= 12) return luminanceDelta > 0 ? 'brighter' : 'darker';

  const maxChannelDelta = Math.max(
    Math.abs(current.r - baseline.r),
    Math.abs(current.g - baseline.g),
    Math.abs(current.b - baseline.b),
  );
  return maxChannelDelta >= 12 ? 'color-shift' : 'mixed';
}

function describeRegionShape(
  rect: { width: number; height: number },
  imageWidth: number,
  imageHeight: number,
): ScreenshotDiffRegion['shape'] {
  if (rect.width >= imageWidth * 0.55 && rect.height >= imageHeight * 0.12) return 'large-area';
  if (rect.width >= rect.height * 2.5) return 'horizontal-band';
  if (rect.height >= rect.width * 2.5) return 'vertical-band';
  return 'compact';
}

function describeRegionSize(regionArea: number, totalPixels: number): ScreenshotDiffRegion['size'] {
  const areaRatio = regionArea / totalPixels;
  if (areaRatio >= 0.04) return 'large';
  if (areaRatio >= 0.01) return 'medium';
  return 'small';
}

function formatDominantChange(change: ScreenshotDiffRegion['dominantChange']): string {
  switch (change) {
    case 'brighter':
      return 'brighter';
    case 'darker':
      return 'darker';
    case 'color-shift':
      return 'color-shifted';
    default:
      return 'mixed';
  }
}

function luminance(color: ScreenshotDiffColor): number {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

function toHexColor(color: ScreenshotDiffColor): string {
  return `#${toHexChannel(color.r)}${toHexChannel(color.g)}${toHexChannel(color.b)}`;
}

function toHexChannel(value: number): string {
  return value.toString(16).padStart(2, '0');
}

function roundPercentage(ratio: number): number {
  return Math.round(ratio * 100 * 100) / 100;
}
