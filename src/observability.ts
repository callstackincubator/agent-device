import type { BackendDumpNetworkResult, BackendNetworkEntry } from './backend.ts';
import {
  NETWORK_LOG_MEMORY_PATH,
  readRecentNetworkTrafficFromText as readRecentNetworkTrafficFromTextInternal,
  type NetworkEntry,
  type NetworkIncludeMode as ParserNetworkIncludeMode,
  type NetworkLogBackend as ParserNetworkLogBackend,
} from './daemon/network-log.ts';
export { redactNetworkLogText, type RedactionResult } from './observability-redaction.ts';

export type NetworkIncludeMode = ParserNetworkIncludeMode;

export type NetworkLogBackend = ParserNetworkLogBackend | (string & {});

export type ParsedNetworkEntry = {
  url: string;
  timestamp?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  headers?: string;
  requestBody?: string;
  responseBody?: string;
  raw?: string;
  line?: number;
  packetId?: string;
  metadata?: {
    packetId?: string;
    [key: string]: unknown;
  };
};

export type ParsedNetworkDump = {
  sourcePath?: string;
  scannedLines: number;
  matchedLines: number;
  entries: ParsedNetworkEntry[];
  include: NetworkIncludeMode;
  limits: {
    maxEntries: number;
    maxPayloadChars: number;
    maxScanLines: number;
  };
};

export function readRecentNetworkTrafficFromText(
  content: string,
  options?: {
    sourcePath?: string;
    backend?: NetworkLogBackend;
    maxEntries?: number;
    include?: NetworkIncludeMode;
    maxPayloadChars?: number;
    maxScanLines?: number;
  },
): ParsedNetworkDump {
  const dump = readRecentNetworkTrafficFromTextInternal(content, {
    path: options?.sourcePath,
    backend: toParserNetworkBackend(options?.backend),
    maxEntries: options?.maxEntries,
    include: options?.include,
    maxPayloadChars: options?.maxPayloadChars,
    maxScanLines: options?.maxScanLines,
  });
  return toParsedNetworkDump(dump, options?.sourcePath);
}

export function mergeNetworkDumps(
  primary: ParsedNetworkDump,
  secondary: ParsedNetworkDump,
  maxEntries = primary.limits.maxEntries,
): ParsedNetworkDump {
  // Keep this public merge decoupled from daemon NetworkDump, which carries
  // filesystem-only fields like exists/path.
  const limit = Math.max(0, maxEntries);
  const entries = primary.entries.slice(0, limit);
  const seen = new Set(entries.map((entry) => networkEntryKey(entry)));
  for (const entry of secondary.entries) {
    if (entries.length >= limit) break;
    const key = networkEntryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  return {
    ...primary,
    matchedLines: entries.length,
    entries,
  };
}

export function mapNetworkDumpToBackendResult(
  dump: ParsedNetworkDump,
  options?: {
    backend?: string;
    redacted?: boolean;
    notes?: readonly string[];
  },
): BackendDumpNetworkResult {
  // The parser exposes diagnostic raw/line/header fields. Backend results keep
  // raw transport details out of first-class fields and preserve them only as metadata.
  return {
    entries: dump.entries.map((entry) => toBackendNetworkEntry(entry)),
    ...(options?.backend ? { backend: options.backend } : {}),
    ...(options?.redacted !== undefined ? { redacted: options.redacted } : {}),
    ...(options?.notes ? { notes: options.notes } : {}),
  };
}

function toParsedNetworkDump(
  dump: {
    path?: string;
    scannedLines: number;
    matchedLines: number;
    entries: NetworkEntry[];
    include: NetworkIncludeMode;
    limits: ParsedNetworkDump['limits'];
  },
  sourcePath: string | undefined,
): ParsedNetworkDump {
  const resolvedSourcePath =
    sourcePath ?? (dump.path === NETWORK_LOG_MEMORY_PATH ? undefined : dump.path);
  return {
    ...(resolvedSourcePath ? { sourcePath: resolvedSourcePath } : {}),
    scannedLines: dump.scannedLines,
    matchedLines: dump.matchedLines,
    entries: dump.entries.map((entry) => ({
      url: entry.url,
      ...(entry.timestamp ? { timestamp: entry.timestamp } : {}),
      ...(entry.method ? { method: entry.method } : {}),
      ...(entry.status !== undefined ? { status: entry.status } : {}),
      ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
      ...(entry.headers ? { headers: entry.headers } : {}),
      ...(entry.requestBody !== undefined ? { requestBody: entry.requestBody } : {}),
      ...(entry.responseBody !== undefined ? { responseBody: entry.responseBody } : {}),
      ...(entry.raw ? { raw: entry.raw } : {}),
      ...(entry.line !== undefined ? { line: entry.line } : {}),
      ...(entry.packetId ? { packetId: entry.packetId } : {}),
    })),
    include: dump.include,
    limits: dump.limits,
  };
}

function toBackendNetworkEntry(entry: ParsedNetworkEntry): BackendNetworkEntry {
  const metadata = buildBackendMetadata(entry);
  return {
    ...(entry.timestamp ? { timestamp: entry.timestamp } : {}),
    ...(entry.method ? { method: entry.method } : {}),
    url: entry.url,
    ...(entry.status !== undefined ? { status: entry.status } : {}),
    ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
    ...(entry.requestBody !== undefined ? { requestBody: entry.requestBody } : {}),
    ...(entry.responseBody !== undefined ? { responseBody: entry.responseBody } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function buildBackendMetadata(entry: ParsedNetworkEntry): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = { ...(entry.metadata ?? {}) };
  if (entry.packetId && metadata.packetId === undefined) {
    metadata.packetId = entry.packetId;
  }
  if (entry.headers && metadata.headers === undefined) {
    metadata.headers = entry.headers;
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function networkEntryKey(entry: ParsedNetworkEntry): string {
  return `${entry.timestamp ?? ''}|${entry.method ?? ''}|${entry.url}|${entry.status ?? ''}|${entry.raw ?? ''}`;
}

function toParserNetworkBackend(
  backend: NetworkLogBackend | undefined,
): ParserNetworkLogBackend | undefined {
  switch (backend) {
    case 'ios-simulator':
      return 'ios-simulator';
    case 'ios-device':
      return 'ios-device';
    case 'android':
      return 'android';
    case 'macos':
      return 'macos';
    default:
      return undefined;
  }
}
