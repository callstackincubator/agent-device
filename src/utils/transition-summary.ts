import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RecordingGestureEvent } from '../daemon/types.ts';
import { AppError } from './errors.ts';
import { resolveUserPath } from './path-resolution.ts';
import { compareScreenshots } from './screenshot-diff.ts';
import type { ScreenshotDiffResult } from './screenshot-diff.ts';
import type { ScreenshotDiffRegion } from './screenshot-diff-regions.ts';

export type FrameSample = {
  index: number;
  path: string;
  timestampMs: number;
};

export type TransitionTelemetryEvent = RecordingGestureEvent;

type BaseTransitionSummaryInput = {
  frameCount: number;
  sampledFrameCount: number;
  durationMs?: number;
  sampleFps?: number;
  telemetryPath?: string;
};

export type TransitionSummaryInput =
  | ({ kind: 'frames' } & BaseTransitionSummaryInput)
  | ({ kind: 'video'; path: string } & BaseTransitionSummaryInput);

export type TransitionSummaryEvent = {
  index: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  classification: string;
  trigger?: string;
  summary: string;
  peakMismatchPercentage: number;
  averageMismatchPercentage: number;
  keyframes: {
    before: string;
    mid: string;
    after: string;
    diff?: string;
  };
  regions?: ScreenshotDiffRegion[];
  ocr?: ScreenshotDiffResult['ocr'];
  nonTextDeltas?: ScreenshotDiffResult['nonTextDeltas'];
};

export type TransitionSummaryResult = {
  input: TransitionSummaryInput;
  outputDir?: string;
  transitions: TransitionSummaryEvent[];
  omittedTransitions: number;
};

export type TransitionSummaryOptions = {
  threshold?: number;
  outputDir?: string;
  telemetryPath?: string;
  maxTransitions?: number;
};

type PairDiff = {
  index: number;
  mismatchPercentage: number;
};

type TransitionSegment = {
  startPairIndex: number;
  endPairIndex: number;
  peakMismatchPercentage: number;
  averageMismatchPercentage: number;
};

type TelemetryEnvelope = {
  version?: unknown;
  events?: unknown;
};

const MIN_SIGNIFICANT_MISMATCH_PERCENTAGE = 0.5;
const SEGMENT_GAP_TOLERANCE_PAIRS = 1;
const DEFAULT_MAX_TRANSITIONS = 5;

export async function summarizeFrameTransitions(params: {
  frames: FrameSample[];
  input: TransitionSummaryInput;
  options?: TransitionSummaryOptions;
}): Promise<TransitionSummaryResult> {
  const frames = [...params.frames].sort((left, right) => left.index - right.index);
  if (frames.length < 2) {
    throw new AppError('INVALID_ARGS', 'transition summary requires at least two frames');
  }

  const threshold = params.options?.threshold ?? 0.1;
  const pairDiffs: PairDiff[] = [];
  for (let index = 0; index < frames.length - 1; index += 1) {
    const diff = await compareScreenshots(frames[index]!.path, frames[index + 1]!.path, {
      threshold,
      includeOcr: false,
      maxRegions: 3,
    });
    pairDiffs.push({
      index,
      mismatchPercentage: diff.mismatchPercentage,
    });
  }

  const telemetryEvents = params.options?.telemetryPath
    ? await readTelemetryEvents(params.options.telemetryPath)
    : [];
  const segments = segmentPairDiffs(pairDiffs);
  const selectedSegments = segments
    .sort((left, right) => right.peakMismatchPercentage - left.peakMismatchPercentage)
    .slice(0, params.options?.maxTransitions ?? DEFAULT_MAX_TRANSITIONS)
    .sort((left, right) => left.startPairIndex - right.startPairIndex);

  const transitions: TransitionSummaryEvent[] = [];
  for (const [index, segment] of selectedSegments.entries()) {
    const before = frames[segment.startPairIndex]!;
    const after = frames[segment.endPairIndex + 1]!;
    const mid = frames[Math.round((segment.startPairIndex + segment.endPairIndex + 1) / 2)]!;
    const diffPath = params.options?.outputDir
      ? path.join(params.options.outputDir, `transition-${index + 1}.diff.png`)
      : undefined;
    const boundaryDiff = await compareScreenshots(before.path, after.path, {
      threshold,
      outputPath: diffPath,
      maxRegions: 5,
    });
    const trigger = findTrigger(telemetryEvents, before.timestampMs, after.timestampMs);
    const classification = classifyTransition(boundaryDiff, trigger);
    transitions.push({
      index: index + 1,
      startMs: before.timestampMs,
      endMs: after.timestampMs,
      durationMs: Math.max(0, after.timestampMs - before.timestampMs),
      classification,
      ...(trigger
        ? { trigger: formatTrigger(trigger, before.timestampMs, after.timestampMs) }
        : {}),
      summary: buildTransitionSummary(boundaryDiff, classification),
      peakMismatchPercentage: roundTwo(segment.peakMismatchPercentage),
      averageMismatchPercentage: roundTwo(segment.averageMismatchPercentage),
      keyframes: {
        before: before.path,
        mid: mid.path,
        after: after.path,
        ...(boundaryDiff.diffPath ? { diff: boundaryDiff.diffPath } : {}),
      },
      ...(boundaryDiff.regions && boundaryDiff.regions.length > 0
        ? { regions: boundaryDiff.regions.slice(0, 5) }
        : {}),
      ...(boundaryDiff.ocr ? { ocr: boundaryDiff.ocr } : {}),
      ...(boundaryDiff.nonTextDeltas && boundaryDiff.nonTextDeltas.length > 0
        ? { nonTextDeltas: boundaryDiff.nonTextDeltas.slice(0, 5) }
        : {}),
    });
  }

  return {
    input: params.input,
    ...(params.options?.outputDir ? { outputDir: params.options.outputDir } : {}),
    transitions,
    omittedTransitions: Math.max(0, segments.length - selectedSegments.length),
  };
}

export async function collectFrameInputs(
  inputs: string[],
  options: { frameIntervalMs?: number } = {},
): Promise<FrameSample[]> {
  if (inputs.length === 0) {
    throw new AppError('INVALID_ARGS', 'diff frames requires a frame path or directory');
  }

  const framePaths: string[] = [];
  if (inputs.length === 1) {
    const resolved = resolveUserPath(inputs[0]!);
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(resolved);
      framePaths.push(
        ...entries
          .filter((entry) => entry.toLowerCase().endsWith('.png'))
          .sort(compareNatural)
          .map((entry) => path.join(resolved, entry)),
      );
    } else {
      framePaths.push(resolved);
    }
  } else {
    framePaths.push(...inputs.map((input) => resolveUserPath(input)));
  }

  if (framePaths.length < 2) {
    throw new AppError('INVALID_ARGS', 'diff frames requires at least two PNG frames');
  }

  const frameIntervalMs = options.frameIntervalMs ?? 100;
  return framePaths.map((framePath, index) => ({
    index,
    path: framePath,
    timestampMs: index * frameIntervalMs,
  }));
}

function segmentPairDiffs(pairDiffs: PairDiff[]): TransitionSegment[] {
  const segments: TransitionSegment[] = [];
  let activePairs: PairDiff[] = [];
  let inactiveGap = 0;

  for (const pair of pairDiffs) {
    if (pair.mismatchPercentage >= MIN_SIGNIFICANT_MISMATCH_PERCENTAGE) {
      activePairs.push(pair);
      inactiveGap = 0;
      continue;
    }
    if (activePairs.length === 0) continue;
    inactiveGap += 1;
    if (inactiveGap <= SEGMENT_GAP_TOLERANCE_PAIRS) continue;
    segments.push(toSegment(activePairs));
    activePairs = [];
    inactiveGap = 0;
  }

  if (activePairs.length > 0) {
    segments.push(toSegment(activePairs));
  }

  return segments;
}

function toSegment(pairs: PairDiff[]): TransitionSegment {
  const peakMismatchPercentage = Math.max(...pairs.map((pair) => pair.mismatchPercentage));
  const averageMismatchPercentage =
    pairs.reduce((sum, pair) => sum + pair.mismatchPercentage, 0) / pairs.length;
  return {
    startPairIndex: pairs[0]!.index,
    endPairIndex: pairs[pairs.length - 1]!.index,
    peakMismatchPercentage,
    averageMismatchPercentage,
  };
}

async function readTelemetryEvents(telemetryPath: string): Promise<TransitionTelemetryEvent[]> {
  try {
    const raw = JSON.parse(
      await fs.readFile(resolveUserPath(telemetryPath), 'utf8'),
    ) as TelemetryEnvelope;
    if (!Array.isArray(raw.events)) return [];
    return raw.events.filter(isTelemetryEvent);
  } catch (error) {
    throw new AppError(
      'INVALID_ARGS',
      `invalid gesture telemetry JSON: ${telemetryPath}`,
      undefined,
      error,
    );
  }
}

function isTelemetryEvent(value: unknown): value is TransitionTelemetryEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<TransitionTelemetryEvent>;
  return typeof event.kind === 'string' && typeof event.tMs === 'number';
}

function findTrigger(
  events: TransitionTelemetryEvent[],
  startMs: number,
  endMs: number,
): TransitionTelemetryEvent | undefined {
  let best: TransitionTelemetryEvent | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const event of events) {
    const durationMs =
      'durationMs' in event && typeof event.durationMs === 'number' ? event.durationMs : 0;
    const eventEndMs = event.tMs + durationMs;
    // Continuous gestures should attach while overlapping the transition; discrete taps
    // often land just before the first changed frame because UI animations start after input.
    const overlaps = event.tMs <= endMs + 250 && eventEndMs >= startMs - 250;
    const before = event.tMs <= startMs && startMs - event.tMs <= 1_000;
    if (!overlaps && !before) continue;
    const distance = Math.abs(startMs - event.tMs);
    if (distance >= bestDistance) continue;
    best = event;
    bestDistance = distance;
  }
  return best;
}

function classifyTransition(
  diff: ScreenshotDiffResult,
  trigger: TransitionTelemetryEvent | undefined,
): string {
  if (trigger?.kind === 'scroll') return `${trigger.contentDirection} scroll`;
  if (trigger?.kind === 'swipe' || trigger?.kind === 'back-swipe') return 'gesture navigation';
  const cluster = diff.ocr?.movementClusters?.[0];
  if (cluster) {
    const dx = maxAbs(cluster.xRange);
    const dy = maxAbs(cluster.yRange);
    if (dx > 24 && dx > dy * 1.5) return 'horizontal navigation';
    if (dy > 24 && dy > dx * 1.5) return 'vertical movement';
  }
  const largestRegion = diff.regions?.[0];
  if (largestRegion?.size === 'large' && largestRegion.shape === 'large-area') {
    if (largestRegion.dominantChange === 'brighter') return 'brightening transition';
    if (largestRegion.dominantChange === 'darker') return 'dimming transition';
    return 'screen replacement';
  }
  return 'screen update';
}

function buildTransitionSummary(diff: ScreenshotDiffResult, classification: string): string {
  const details: string[] = [classification];
  const cluster = diff.ocr?.movementClusters?.[0];
  if (cluster) {
    details.push(
      `text moved dx=${formatRange(cluster.xRange)}px dy=${formatRange(cluster.yRange)}px`,
    );
  }
  const region = diff.regions?.[0];
  if (region) {
    details.push(`${region.size} ${region.location} ${region.shape} changed`);
  }
  return details.join('; ');
}

function formatTrigger(event: TransitionTelemetryEvent, startMs: number, endMs: number): string {
  const relation =
    isContinuousGesture(event) && event.tMs >= startMs && event.tMs <= endMs ? 'during' : 'after';
  if (event.kind === 'scroll') return `${relation} ${event.contentDirection} scroll`;
  if (event.kind === 'pinch') return `${relation} pinch scale=${event.scale}`;
  return `${relation} ${event.kind} x=${Math.round(event.x)} y=${Math.round(event.y)}`;
}

function isContinuousGesture(event: TransitionTelemetryEvent): boolean {
  return ['scroll', 'swipe', 'back-swipe', 'pinch'].includes(event.kind);
}

function maxAbs(range: { min: number; max: number }): number {
  return Math.max(Math.abs(range.min), Math.abs(range.max));
}

function formatRange(range: { min: number; max: number }): string {
  return range.min === range.max
    ? formatSigned(range.min)
    : `${formatSigned(range.min)}..${formatSigned(range.max)}`;
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function compareNatural(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}
