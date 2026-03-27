import { promises as fs } from 'node:fs';
import { PNG } from 'pngjs';
import type { Rect, SnapshotNode, SnapshotState } from '../utils/snapshot.ts';
import { AppError } from '../utils/errors.ts';
import {
  findNearestHittableAncestor,
  normalizeType,
  resolveRefLabel,
} from './snapshot-processing.ts';

const MAX_OVERLAY_REFS = 24;
const BORDER_COLOR = [255, 59, 48, 255] as const;
const BADGE_COLOR = [255, 214, 10, 255] as const;
const TEXT_COLOR = [0, 0, 0, 255] as const;
const FONT_WIDTH = 5;
const FONT_HEIGHT = 7;
const FONT_SPACING = 1;
const BADGE_PADDING_X = 3;
const BADGE_PADDING_Y = 2;
const BADGE_MARGIN = 2;
const BORDER_THICKNESS = 2;

const FONT: Record<string, readonly string[]> = {
  e: ['01110', '10000', '11110', '10000', '10000', '10001', '01110'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
} as const;

export type ScreenshotOverlayRef = {
  ref: string;
  label?: string;
  rect: Rect;
  overlayRect: Rect;
};

type OverlayCandidate = ScreenshotOverlayRef & {
  score: number;
};

export async function annotateScreenshotWithRefs(params: {
  screenshotPath: string;
  snapshot: SnapshotState;
  maxRefs?: number;
}): Promise<ScreenshotOverlayRef[]> {
  const screenshotBuffer = await fs.readFile(params.screenshotPath);
  const png = decodeScreenshotPng(screenshotBuffer);
  const overlayRefs = buildScreenshotOverlayRefs(params.snapshot, png.width, png.height, {
    maxRefs: params.maxRefs,
  });

  for (const overlayRef of overlayRefs) {
    drawOverlayRef(png, overlayRef);
  }

  await fs.writeFile(params.screenshotPath, PNG.sync.write(png));
  return overlayRefs;
}

export function buildScreenshotOverlayRefs(
  snapshot: SnapshotState,
  screenshotWidth: number,
  screenshotHeight: number,
  options: { maxRefs?: number } = {},
): ScreenshotOverlayRef[] {
  const candidatesByRef = new Map<string, OverlayCandidate>();
  for (const node of snapshot.nodes) {
    if (!isOverlaySourceNode(node)) continue;
    const target = resolveOverlayTarget(snapshot.nodes, node);
    if (!target?.rect || !hasPositiveRect(target.rect)) continue;
    const label = resolveRefLabel(target, snapshot.nodes);
    const score = scoreOverlayCandidate(node, target, label);
    const overlayRect = projectRectToScreenshot(
      snapshot.nodes,
      target.rect,
      screenshotWidth,
      screenshotHeight,
    );
    if (!hasPositiveRect(overlayRect)) continue;
    const existing = candidatesByRef.get(target.ref);
    if (!existing || score > existing.score) {
      candidatesByRef.set(target.ref, {
        ref: target.ref,
        label,
        rect: target.rect,
        overlayRect,
        score,
      });
    }
  }

  const ranked = suppressContainedCandidates([...candidatesByRef.values()])
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const topDelta = left.overlayRect.y - right.overlayRect.y;
      if (topDelta !== 0) return topDelta;
      const leftDelta = left.overlayRect.x - right.overlayRect.x;
      if (leftDelta !== 0) return leftDelta;
      return compareNumericRefs(left.ref, right.ref);
    })
    .slice(0, options.maxRefs ?? MAX_OVERLAY_REFS)
    .sort((left, right) => {
      const topDelta = left.overlayRect.y - right.overlayRect.y;
      if (topDelta !== 0) return topDelta;
      const leftDelta = left.overlayRect.x - right.overlayRect.x;
      if (leftDelta !== 0) return leftDelta;
      return compareNumericRefs(left.ref, right.ref);
    });

  return ranked.map(({ score: _score, ...overlayRef }) => overlayRef);
}

function decodeScreenshotPng(buffer: Buffer): PNG {
  try {
    return PNG.sync.read(buffer);
  } catch (error) {
    throw new AppError('COMMAND_FAILED', 'Failed to decode screenshot as PNG', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function isOverlaySourceNode(node: SnapshotNode): boolean {
  const hasTextSignal = [node.label, node.value, node.identifier].some(isMeaningfulSignal);
  return hasTextSignal || hasActionableRole(node);
}

function resolveOverlayTarget(
  nodes: SnapshotState['nodes'],
  node: SnapshotNode,
): SnapshotNode | null {
  if (node.hittable && hasPositiveRect(node.rect)) return node;
  const ancestor = findNearestHittableAncestor(nodes, node);
  if (ancestor?.rect && hasPositiveRect(ancestor.rect)) return ancestor;
  return null;
}

function scoreOverlayCandidate(
  source: SnapshotNode,
  target: SnapshotNode,
  label: string | undefined,
): number {
  let score = 0;
  if (source.ref === target.ref) score += 4;
  if (target.hittable) score += 3;
  if (hasActionableRole(target)) score += 3;
  if (hasActionableRole(source)) score += 2;
  if (label) score += 2;
  if (isMeaningfulSignal(target.identifier)) score += 1;
  if (isMeaningfulSignal(target.value)) score += 1;
  return score;
}

function suppressContainedCandidates(candidates: OverlayCandidate[]): OverlayCandidate[] {
  const kept: OverlayCandidate[] = [];
  for (const candidate of candidates.sort(
    (left, right) => rectArea(left.overlayRect) - rectArea(right.overlayRect),
  )) {
    const duplicateIndex = kept.findIndex(
      (current) =>
        current.label === candidate.label &&
        (rectContains(current.overlayRect, candidate.overlayRect) ||
          rectContains(candidate.overlayRect, current.overlayRect)),
    );
    if (duplicateIndex === -1) {
      kept.push(candidate);
      continue;
    }
    if (rectArea(candidate.overlayRect) < rectArea(kept[duplicateIndex]!.overlayRect)) {
      kept[duplicateIndex] = candidate;
    }
  }
  return kept;
}

function projectRectToScreenshot(
  nodes: SnapshotState['nodes'],
  rect: Rect,
  screenshotWidth: number,
  screenshotHeight: number,
): Rect {
  const bounds = measureSnapshotBounds(nodes);
  if (!bounds) {
    return clampRect(
      {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      screenshotWidth,
      screenshotHeight,
    );
  }
  const scaleX = screenshotWidth / bounds.width;
  const scaleY = screenshotHeight / bounds.height;
  return clampRect(
    {
      x: Math.round((rect.x - bounds.x) * scaleX),
      y: Math.round((rect.y - bounds.y) * scaleY),
      width: Math.max(1, Math.round(rect.width * scaleX)),
      height: Math.max(1, Math.round(rect.height * scaleY)),
    },
    screenshotWidth,
    screenshotHeight,
  );
}

function measureSnapshotBounds(nodes: SnapshotState['nodes']): Rect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxRight = Number.NEGATIVE_INFINITY;
  let maxBottom = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    if (!node.rect || !hasPositiveRect(node.rect)) continue;
    minX = Math.min(minX, node.rect.x);
    minY = Math.min(minY, node.rect.y);
    maxRight = Math.max(maxRight, node.rect.x + node.rect.width);
    maxBottom = Math.max(maxBottom, node.rect.y + node.rect.height);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || maxRight <= minX || maxBottom <= minY) {
    return null;
  }
  return {
    x: minX,
    y: minY,
    width: maxRight - minX,
    height: maxBottom - minY,
  };
}

function hasActionableRole(node: SnapshotNode): boolean {
  const roleText = [node.type, node.role, node.subrole]
    .map((value) => normalizeType(value ?? ''))
    .join(' ');
  return (
    roleText.includes('button') ||
    roleText.includes('link') ||
    roleText.includes('menu') ||
    roleText.includes('tab') ||
    roleText.includes('textfield') ||
    roleText.includes('searchfield') ||
    roleText.includes('securetextfield') ||
    roleText.includes('checkbox') ||
    roleText.includes('radio') ||
    roleText.includes('switch') ||
    roleText.includes('cell')
  );
}

function isMeaningfulSignal(value: string | undefined): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^(true|false)$/i.test(trimmed)) return false;
  return true;
}

function hasPositiveRect(rect: Rect | undefined): rect is Rect {
  return Boolean(rect && rect.width > 0 && rect.height > 0);
}

function rectArea(rect: Rect): number {
  return rect.width * rect.height;
}

function rectContains(container: Rect, nested: Rect): boolean {
  return (
    nested.x >= container.x &&
    nested.y >= container.y &&
    nested.x + nested.width <= container.x + container.width &&
    nested.y + nested.height <= container.y + container.height
  );
}

function compareNumericRefs(left: string, right: string): number {
  const leftValue = Number.parseInt(left.replace(/^\D+/, ''), 10);
  const rightValue = Number.parseInt(right.replace(/^\D+/, ''), 10);
  return leftValue - rightValue;
}

function clampRect(rect: Rect, width: number, height: number): Rect {
  const x = clamp(rect.x, 0, Math.max(0, width - 1));
  const y = clamp(rect.y, 0, Math.max(0, height - 1));
  const maxWidth = Math.max(1, width - x);
  const maxHeight = Math.max(1, height - y);
  return {
    x,
    y,
    width: clamp(rect.width, 1, maxWidth),
    height: clamp(rect.height, 1, maxHeight),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function drawOverlayRef(png: PNG, overlayRef: ScreenshotOverlayRef): void {
  drawRectBorder(png, overlayRef.overlayRect, BORDER_COLOR, BORDER_THICKNESS);
  drawBadge(png, overlayRef.overlayRect, overlayRef.ref);
}

function drawRectBorder(
  png: PNG,
  rect: Rect,
  color: readonly [number, number, number, number],
  thickness: number,
): void {
  for (let offset = 0; offset < thickness; offset += 1) {
    drawHorizontalLine(png, rect.x, rect.x + rect.width - 1, rect.y + offset, color);
    drawHorizontalLine(
      png,
      rect.x,
      rect.x + rect.width - 1,
      rect.y + rect.height - 1 - offset,
      color,
    );
    drawVerticalLine(png, rect.x + offset, rect.y, rect.y + rect.height - 1, color);
    drawVerticalLine(
      png,
      rect.x + rect.width - 1 - offset,
      rect.y,
      rect.y + rect.height - 1,
      color,
    );
  }
}

function drawBadge(png: PNG, rect: Rect, text: string): void {
  const badgeWidth =
    BADGE_PADDING_X * 2 + text.length * FONT_WIDTH + Math.max(0, text.length - 1) * FONT_SPACING;
  const badgeHeight = BADGE_PADDING_Y * 2 + FONT_HEIGHT;
  const x = clamp(rect.x, 0, Math.max(0, png.width - badgeWidth));
  const preferredY = rect.y - badgeHeight - BADGE_MARGIN;
  const y =
    preferredY >= 0
      ? preferredY
      : clamp(rect.y + BADGE_MARGIN, 0, Math.max(0, png.height - badgeHeight));
  fillRect(png, x, y, badgeWidth, badgeHeight, BADGE_COLOR);
  drawText(png, x + BADGE_PADDING_X, y + BADGE_PADDING_Y, text, TEXT_COLOR);
}

function drawText(
  png: PNG,
  x: number,
  y: number,
  text: string,
  color: readonly [number, number, number, number],
): void {
  let cursorX = x;
  for (const character of text.toLowerCase()) {
    const glyph = FONT[character];
    if (glyph) {
      for (let row = 0; row < glyph.length; row += 1) {
        for (let column = 0; column < glyph[row]!.length; column += 1) {
          if (glyph[row]![column] !== '1') continue;
          setPixel(png, cursorX + column, y + row, color);
        }
      }
    }
    cursorX += FONT_WIDTH + FONT_SPACING;
  }
}

function fillRect(
  png: PNG,
  x: number,
  y: number,
  width: number,
  height: number,
  color: readonly [number, number, number, number],
): void {
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      setPixel(png, x + column, y + row, color);
    }
  }
}

function drawHorizontalLine(
  png: PNG,
  startX: number,
  endX: number,
  y: number,
  color: readonly [number, number, number, number],
): void {
  for (let x = startX; x <= endX; x += 1) {
    setPixel(png, x, y, color);
  }
}

function drawVerticalLine(
  png: PNG,
  x: number,
  startY: number,
  endY: number,
  color: readonly [number, number, number, number],
): void {
  for (let y = startY; y <= endY; y += 1) {
    setPixel(png, x, y, color);
  }
}

function setPixel(
  png: PNG,
  x: number,
  y: number,
  color: readonly [number, number, number, number],
): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const index = (png.width * y + x) * 4;
  png.data[index] = color[0];
  png.data[index + 1] = color[1];
  png.data[index + 2] = color[2];
  png.data[index + 3] = color[3];
}
