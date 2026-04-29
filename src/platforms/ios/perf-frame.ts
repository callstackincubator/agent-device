import { roundPercent } from '../perf-utils.ts';
import { parseXmlDocumentSync, type XmlNode } from './xml.ts';

const MAX_WORST_WINDOWS = 3;
const JANK_WINDOW_GAP_NS = 500_000_000;

export const APPLE_FRAME_SAMPLE_METHOD = 'xctrace-animation-hitches';
export const APPLE_FRAME_SAMPLE_DESCRIPTION =
  'Rendered-frame hitch health from xctrace Animation Hitches on connected iOS devices. Dropped frames are counted from native hitch rows for the attached app process, with total frames from the same trace frame-lifetime table.';

export type AppleFrameDropWindow = {
  startOffsetMs: number;
  endOffsetMs: number;
  startAt?: string;
  endAt?: string;
  missedDeadlineFrameCount: number;
  worstFrameMs: number;
};

export type AppleFramePerfSample = {
  droppedFramePercent: number;
  droppedFrameCount: number;
  totalFrameCount: number;
  sampleWindowMs: number;
  windowStartedAt: string;
  windowEndedAt: string;
  timestampSource: 'xctrace-record-window';
  measuredAt: string;
  method: typeof APPLE_FRAME_SAMPLE_METHOD;
  source: 'xctrace-animation-hitches';
  attribution: 'attached-process-hitches-with-trace-frame-total';
  matchedProcesses: string[];
  frameDeadlineMs?: number;
  refreshRateHz?: number;
  worstWindows?: AppleFrameDropWindow[];
};

type AppleFrameHitchRow = {
  startNs: number;
  durationNs: number;
  pid?: number;
  processName?: string;
};

type XmlReference = {
  numberValue?: number | null;
  textValue?: string | null;
  process?: { pid?: number; name?: string } | null;
};

export function parseAppleFramePerfSample(options: {
  hitchesXml: string;
  frameLifetimesXml: string;
  displayInfoXml?: string;
  processIds: number[];
  processNames: string[];
  windowStartedAt: string;
  windowEndedAt: string;
  measuredAt: string;
}): AppleFramePerfSample {
  const totalFrameCount = parseAppleFrameLifetimeCount(options.frameLifetimesXml);
  const refreshRateHz = parseAppleDisplayRefreshRate(options.displayInfoXml);
  const hitches = parseAppleHitchRows(options.hitchesXml).filter((row) =>
    matchesAppleFrameProcess(row, options.processIds, options.processNames),
  );
  const droppedFrameCount = hitches.length;
  const sampleWindowMs = Math.max(
    0,
    Math.round(Date.parse(options.windowEndedAt) - Date.parse(options.windowStartedAt)),
  );
  const windowStartedAtMs = Date.parse(options.windowStartedAt);
  const worstWindows = buildAppleWorstWindows(hitches, windowStartedAtMs);

  return {
    droppedFramePercent:
      totalFrameCount > 0 ? roundPercent((droppedFrameCount / totalFrameCount) * 100) : 0,
    droppedFrameCount,
    totalFrameCount,
    sampleWindowMs,
    windowStartedAt: options.windowStartedAt,
    windowEndedAt: options.windowEndedAt,
    timestampSource: 'xctrace-record-window',
    measuredAt: options.measuredAt,
    method: APPLE_FRAME_SAMPLE_METHOD,
    source: 'xctrace-animation-hitches',
    attribution: 'attached-process-hitches-with-trace-frame-total',
    matchedProcesses: uniqueStrings(
      hitches
        .map((row) => row.processName)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
    frameDeadlineMs:
      refreshRateHz === undefined ? undefined : Math.round((1000 / refreshRateHz) * 10) / 10,
    refreshRateHz,
    worstWindows: worstWindows.length > 0 ? worstWindows : undefined,
  };
}

function parseAppleFrameLifetimeCount(xml: string): number {
  return parseRows(xml, 'hitches-frame-lifetimes').length;
}

function parseAppleDisplayRefreshRate(xml: string | undefined): number | undefined {
  if (!xml) return undefined;
  const rows = parseRows(xml, 'device-display-info');
  const schema = readSchemaColumns(parseXmlDocumentSync(xml), 'device-display-info');
  const refreshIndex = schema.indexOf('max-refresh-rate');
  if (refreshIndex < 0) return undefined;
  const references = new Map<string, XmlReference>();
  for (const row of rows) {
    rememberXmlReferences(row.children, references);
    const refreshRate = resolveXmlNumber(row.children[refreshIndex], references);
    if (refreshRate !== null && refreshRate > 0) return refreshRate;
  }
  return undefined;
}

function parseAppleHitchRows(xml: string): AppleFrameHitchRow[] {
  const document = parseXmlDocumentSync(xml);
  const schema = readSchemaColumns(document, 'hitches');
  const startIndex = schema.indexOf('start');
  const durationIndex = schema.indexOf('duration');
  const processIndex = schema.indexOf('process');
  const isSystemIndex = schema.indexOf('is-system');
  if (startIndex < 0 || durationIndex < 0 || processIndex < 0 || isSystemIndex < 0) {
    return [];
  }

  const rows: AppleFrameHitchRow[] = [];
  const references = new Map<string, XmlReference>();
  for (const row of findAllXmlNodes(document, (node) => node.name === 'row')) {
    rememberXmlReferences(row.children, references);
    const isSystem = resolveXmlBoolean(row.children[isSystemIndex], references);
    if (isSystem === true) continue;
    const startNs = resolveXmlNumber(row.children[startIndex], references);
    const durationNs = resolveXmlNumber(row.children[durationIndex], references);
    const process = resolveXmlProcess(row.children[processIndex], references);
    if (startNs === null || durationNs === null) continue;
    rows.push({ startNs, durationNs, pid: process?.pid, processName: process?.name });
  }
  return rows;
}

function matchesAppleFrameProcess(
  row: AppleFrameHitchRow,
  processIds: number[],
  processNames: string[],
): boolean {
  if (row.pid !== undefined && processIds.includes(row.pid)) return true;
  if (!row.processName) return false;
  return processNames.includes(row.processName);
}

function buildAppleWorstWindows(
  hitches: AppleFrameHitchRow[],
  windowStartedAtMs: number,
): AppleFrameDropWindow[] {
  if (hitches.length === 0) return [];
  const sorted = [...hitches].sort((left, right) => left.startNs - right.startNs);
  const windows: AppleFrameHitchRow[][] = [];
  let current: AppleFrameHitchRow[] = [];
  for (const hitch of sorted) {
    const previous = current.at(-1);
    if (
      !previous ||
      hitch.startNs - (previous.startNs + previous.durationNs) <= JANK_WINDOW_GAP_NS
    ) {
      current.push(hitch);
      continue;
    }
    windows.push(current);
    current = [hitch];
  }
  if (current.length > 0) windows.push(current);

  return windows
    .map((rows) => buildAppleWorstWindow(rows, windowStartedAtMs))
    .sort(
      (left, right) =>
        right.missedDeadlineFrameCount - left.missedDeadlineFrameCount ||
        right.worstFrameMs - left.worstFrameMs,
    )
    .slice(0, MAX_WORST_WINDOWS)
    .sort((left, right) => left.startOffsetMs - right.startOffsetMs);
}

function buildAppleWorstWindow(
  hitches: AppleFrameHitchRow[],
  windowStartedAtMs: number,
): AppleFrameDropWindow {
  const startNs = Math.min(...hitches.map((hitch) => hitch.startNs));
  const endNs = Math.max(...hitches.map((hitch) => hitch.startNs + hitch.durationNs));
  const startOffsetMs = Math.max(0, Math.round(startNs / 1_000_000));
  const endOffsetMs = Math.max(startOffsetMs, Math.round(endNs / 1_000_000));
  return {
    startOffsetMs,
    endOffsetMs,
    startAt: new Date(windowStartedAtMs + startOffsetMs).toISOString(),
    endAt: new Date(windowStartedAtMs + endOffsetMs).toISOString(),
    missedDeadlineFrameCount: hitches.length,
    worstFrameMs:
      Math.round((Math.max(...hitches.map((hitch) => hitch.durationNs)) / 1_000_000) * 10) / 10,
  };
}

function parseRows(xml: string, schemaName: string): XmlNode[] {
  const document = parseXmlDocumentSync(xml);
  const schema = readSchemaColumns(document, schemaName);
  if (schema.length === 0) return [];
  return findAllXmlNodes(document, (node) => node.name === 'row');
}

function readSchemaColumns(document: XmlNode[], schemaName: string): string[] {
  const schema = findFirstXmlNode(
    document,
    (node) => node.name === 'schema' && node.attributes.name === schemaName,
  );
  if (!schema) return [];
  return schema.children
    .filter((child) => child.name === 'col')
    .map((column) => readFirstChildText(column, 'mnemonic') ?? '');
}

function rememberXmlReferences(elements: XmlNode[], references: Map<string, XmlReference>): void {
  for (const element of elements) {
    rememberXmlReferences(element.children, references);
    if (!element.attributes.id) continue;
    references.set(element.attributes.id, {
      numberValue: parseDirectXmlNumber(element),
      textValue: readDirectXmlText(element),
      process: readDirectProcess(element),
    });
  }
}

function parseDirectXmlNumber(element: XmlNode | undefined): number | null {
  if (!element || element.children.some((child) => child.name === 'sentinel')) return null;
  if (!element.text) return null;
  const value = Number(element.text);
  return Number.isFinite(value) ? value : null;
}

function readDirectXmlText(element: XmlNode | undefined): string | null {
  const value = element?.attributes.fmt?.trim() || element?.text?.trim() || '';
  return value.length > 0 ? value : null;
}

function resolveXmlNumber(
  element: XmlNode | undefined,
  references: Map<string, XmlReference>,
): number | null {
  if (!element) return null;
  if (element.attributes.ref) return references.get(element.attributes.ref)?.numberValue ?? null;
  return parseDirectXmlNumber(element);
}

function resolveXmlBoolean(
  element: XmlNode | undefined,
  references: Map<string, XmlReference>,
): boolean | null {
  const value = resolveXmlNumber(element, references);
  if (value === null) return null;
  return value !== 0;
}

function resolveXmlProcess(
  element: XmlNode | undefined,
  references: Map<string, XmlReference>,
): { pid?: number; name?: string } | null {
  if (!element) return null;
  if (element.attributes.ref) return references.get(element.attributes.ref)?.process ?? null;
  return readDirectProcess(element);
}

function readDirectProcess(element: XmlNode | undefined): { pid?: number; name?: string } | null {
  if (!element || element.children.some((child) => child.name === 'sentinel')) return null;
  const pidNode = findFirstXmlNode(element.children, (child) => child.name === 'pid');
  const pid = parseDirectXmlNumber(pidNode);
  const name = (element.attributes.fmt ?? '').replace(/\s+\(\d+\)$/, '').trim();
  if (pid === null && name.length === 0) return null;
  return {
    pid: pid ?? undefined,
    name: name.length > 0 ? name : undefined,
  };
}

function findFirstXmlNode(
  nodes: XmlNode[],
  predicate: (node: XmlNode) => boolean,
): XmlNode | undefined {
  for (const node of nodes) {
    if (predicate(node)) return node;
    const descendant = findFirstXmlNode(node.children, predicate);
    if (descendant) return descendant;
  }
  return undefined;
}

function findAllXmlNodes(nodes: XmlNode[], predicate: (node: XmlNode) => boolean): XmlNode[] {
  const matches: XmlNode[] = [];
  for (const node of nodes) {
    if (predicate(node)) matches.push(node);
    matches.push(...findAllXmlNodes(node.children, predicate));
  }
  return matches;
}

function readFirstChildText(node: XmlNode, childName: string): string | null {
  const child = node.children.find((candidate) => candidate.name === childName);
  return child?.text ?? null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
