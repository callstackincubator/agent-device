import fs from 'node:fs';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
const METHOD_REGEX = new RegExp(`\\b(${HTTP_METHODS.join('|')})\\b`, 'i');
const URL_REGEX = /https?:\/\/[^\s"'<>\])]+/i;
const STATUS_PATTERNS = [
  /\bstatus(?:Code)?["'=: ]+([1-5]\d{2})\b/i,
  /\bresponse(?:\s+code)?["'=: ]+([1-5]\d{2})\b/i,
  /\bHTTP\/[0-9.]+\s+([1-5]\d{2})\b/i,
];

type NetworkIncludeMode = 'summary' | 'headers' | 'body' | 'all';

export type NetworkEntry = {
  method?: string;
  url: string;
  status?: number;
  timestamp?: string;
  headers?: string;
  requestBody?: string;
  responseBody?: string;
  raw: string;
  line: number;
};

export type NetworkDump = {
  path: string;
  exists: boolean;
  scannedLines: number;
  matchedLines: number;
  entries: NetworkEntry[];
  include: NetworkIncludeMode;
  limits: {
    maxEntries: number;
    maxPayloadChars: number;
    maxScanLines: number;
  };
};

export function readRecentNetworkTraffic(
  logPath: string,
  options?: {
    maxEntries?: number;
    include?: NetworkIncludeMode;
    maxPayloadChars?: number;
    maxScanLines?: number;
  },
): NetworkDump {
  const maxEntries = clampInt(options?.maxEntries, 25, 1, 200);
  const include = options?.include ?? 'summary';
  const maxPayloadChars = clampInt(options?.maxPayloadChars, 2048, 64, 16_384);
  const maxScanLines = clampInt(options?.maxScanLines, 4000, 100, 20_000);
  if (!fs.existsSync(logPath)) {
    return {
      path: logPath,
      exists: false,
      scannedLines: 0,
      matchedLines: 0,
      entries: [],
      include,
      limits: { maxEntries, maxPayloadChars, maxScanLines },
    };
  }

  const content = fs.readFileSync(logPath, 'utf8');
  const allLines = content.split('\n');
  const startIndex = Math.max(0, allLines.length - maxScanLines);
  const lines = allLines.slice(startIndex);
  const entries: NetworkEntry[] = [];

  for (let i = lines.length - 1; i >= 0 && entries.length < maxEntries; i -= 1) {
    const rawLine = lines[i]?.trim();
    if (!rawLine) continue;
    const parsed = parseNetworkLine(rawLine, startIndex + i + 1, include, maxPayloadChars);
    if (!parsed) continue;
    entries.push(parsed);
  }

  return {
    path: logPath,
    exists: true,
    scannedLines: lines.length,
    matchedLines: entries.length,
    entries,
    include,
    limits: { maxEntries, maxPayloadChars, maxScanLines },
  };
}

function parseNetworkLine(
  line: string,
  lineNumber: number,
  include: NetworkIncludeMode,
  maxPayloadChars: number,
): NetworkEntry | null {
  const maybeJson = parseEmbeddedJson(line);
  const jsonMethod = readJsonString(maybeJson, ['method', 'httpMethod']);
  const jsonUrl = readJsonString(maybeJson, ['url', 'requestUrl']);
  const jsonStatus = readJsonNumber(maybeJson, ['status', 'statusCode', 'responseCode']);

  const methodMatch = METHOD_REGEX.exec(line);
  const methodFieldMatch = /\bmethod["'=: ]+([A-Z]+)\b/i.exec(line);
  const method = (jsonMethod ?? methodFieldMatch?.[1] ?? methodMatch?.[1])?.toUpperCase();

  const urlMatch = URL_REGEX.exec(line);
  const url = jsonUrl ?? urlMatch?.[0];
  if (!url) return null;

  const status = jsonStatus ?? parseStatusCode(line) ?? undefined;
  const timestamp = parseTimestamp(line);

  const result: NetworkEntry = {
    method,
    url,
    status,
    timestamp,
    raw: truncate(line, maxPayloadChars),
    line: lineNumber,
  };

  if (include === 'headers' || include === 'all') {
    const headers = readHeaders(line, maybeJson);
    if (headers) {
      result.headers = truncate(headers, maxPayloadChars);
    }
  }

  if (include === 'body' || include === 'all') {
    const requestBody = readBody(line, maybeJson, ['requestBody', 'body', 'payload', 'request']);
    const responseBody = readBody(line, maybeJson, ['responseBody', 'response']);
    if (requestBody) result.requestBody = truncate(requestBody, maxPayloadChars);
    if (responseBody) result.responseBody = truncate(responseBody, maxPayloadChars);
  }

  return result;
}

function parseStatusCode(line: string): number | null {
  for (const pattern of STATUS_PATTERNS) {
    const match = pattern.exec(line);
    if (!match) continue;
    const value = Number.parseInt(match[1] ?? '', 10);
    if (Number.isInteger(value)) return value;
  }
  return null;
}

function parseTimestamp(line: string): string | undefined {
  const match = /\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z)?\b/.exec(line);
  return match?.[0];
}

function parseEmbeddedJson(line: string): Record<string, unknown> | null {
  const start = line.indexOf('{');
  if (start < 0) return null;
  const end = line.lastIndexOf('}');
  if (end <= start) return null;
  const candidate = line.slice(start, end + 1);
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readJsonString(
  value: Record<string, unknown> | null,
  keys: string[],
): string | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    const next = value[key];
    if (typeof next === 'string' && next.trim().length > 0) {
      return next.trim();
    }
  }
  return undefined;
}

function readJsonNumber(
  value: Record<string, unknown> | null,
  keys: string[],
): number | null {
  if (!value) return null;
  for (const key of keys) {
    const next = value[key];
    if (typeof next === 'number' && Number.isInteger(next)) return next;
    if (typeof next === 'string' && /^\d{3}$/.test(next.trim())) {
      return Number.parseInt(next.trim(), 10);
    }
  }
  return null;
}

function readHeaders(line: string, json: Record<string, unknown> | null): string | undefined {
  if (json) {
    const headers = json.headers ?? json.requestHeaders ?? json.responseHeaders;
    if (headers !== undefined) return stringifyValue(headers);
  }
  const match = /\bheaders?["'=: ]+(\{.*\})/i.exec(line);
  return match?.[1]?.trim();
}

function readBody(
  line: string,
  json: Record<string, unknown> | null,
  jsonKeys: string[],
): string | undefined {
  if (json) {
    for (const key of jsonKeys) {
      if (json[key] !== undefined) return stringifyValue(json[key]);
    }
  }
  for (const key of jsonKeys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}["'=: ]+(.+)$`, 'i');
    const match = regex.exec(line);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...<truncated>`;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
