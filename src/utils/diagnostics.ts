import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type DiagnosticLevel = 'info' | 'warn' | 'error' | 'debug';

export type DiagnosticEvent = {
  ts: string;
  level: DiagnosticLevel;
  phase: string;
  session?: string;
  requestId?: string;
  command?: string;
  durationMs?: number;
  data?: Record<string, unknown>;
};

export type DiagnosticsScopeOptions = {
  session?: string;
  requestId?: string;
  command?: string;
  debug?: boolean;
  logPath?: string;
  traceLogPath?: string;
};

type DiagnosticsScope = DiagnosticsScopeOptions & {
  diagnosticId: string;
  events: DiagnosticEvent[];
};

const diagnosticsStorage = new AsyncLocalStorage<DiagnosticsScope>();

const SENSITIVE_KEY_RE = /(token|secret|password|authorization|cookie|api[_-]?key|access[_-]?key|private[_-]?key)/i;
const SENSITIVE_VALUE_RE = /(bearer\s+[a-z0-9._-]+|(?:api[_-]?key|token|secret|password)\s*[=:]\s*\S+)/i;

export function createRequestId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function createDiagnosticId(): string {
  return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

export async function withDiagnosticsScope<T>(
  options: DiagnosticsScopeOptions,
  fn: () => Promise<T> | T,
): Promise<T> {
  const scope: DiagnosticsScope = {
    ...options,
    diagnosticId: createDiagnosticId(),
    events: [],
  };
  return await diagnosticsStorage.run(scope, fn);
}

export function getDiagnosticsMeta(): {
  diagnosticId?: string;
  requestId?: string;
  session?: string;
  command?: string;
  debug?: boolean;
} {
  const scope = diagnosticsStorage.getStore();
  if (!scope) return {};
  return {
    diagnosticId: scope.diagnosticId,
    requestId: scope.requestId,
    session: scope.session,
    command: scope.command,
    debug: scope.debug,
  };
}

export function emitDiagnostic(event: {
  level?: DiagnosticLevel;
  phase: string;
  durationMs?: number;
  data?: Record<string, unknown>;
}): void {
  const scope = diagnosticsStorage.getStore();
  if (!scope) return;
  const payload: DiagnosticEvent = {
    ts: new Date().toISOString(),
    level: event.level ?? 'info',
    phase: event.phase,
    session: scope.session,
    requestId: scope.requestId,
    command: scope.command,
    durationMs: event.durationMs,
    data: event.data ? redactDiagnosticData(event.data) : undefined,
  };
  scope.events.push(payload);
  if (!scope.debug) return;
  const line = `[agent-device][diag] ${JSON.stringify(payload)}\n`;
  try {
    if (scope.logPath) {
      fs.appendFile(scope.logPath, line, () => {});
    }
    if (scope.traceLogPath) {
      fs.appendFile(scope.traceLogPath, line, () => {});
    }
    if (!scope.logPath && !scope.traceLogPath) process.stderr.write(line);
  } catch {
    // Best-effort diagnostics should not break request flow.
  }
}

export async function withDiagnosticTimer<T>(
  phase: string,
  fn: () => Promise<T> | T,
  data?: Record<string, unknown>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    emitDiagnostic({
      level: 'info',
      phase,
      durationMs: Date.now() - start,
      data,
    });
    return result;
  } catch (error) {
    emitDiagnostic({
      level: 'error',
      phase,
      durationMs: Date.now() - start,
      data: {
        ...(data ?? {}),
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

export function flushDiagnosticsToSessionFile(options: { force?: boolean } = {}): string | null {
  const scope = diagnosticsStorage.getStore();
  if (!scope) return null;
  if (!options.force && !scope.debug) return null;
  if (scope.events.length === 0) return null;

  try {
    const sessionDir = sanitizePathPart(scope.session ?? 'default');
    const dayDir = new Date().toISOString().slice(0, 10);
    const baseDir = path.join(os.homedir(), '.agent-device', 'logs', sessionDir, dayDir);
    fs.mkdirSync(baseDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(baseDir, `${timestamp}-${scope.diagnosticId}.ndjson`);
    const lines = scope.events.map((entry) => JSON.stringify(redactDiagnosticData(entry)));
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
    scope.events = [];
    return filePath;
  } catch {
    return null;
  }
}

export function redactDiagnosticData<T>(input: T): T {
  return redactValue(input, new WeakSet<object>()) as T;
}

function redactValue(value: unknown, seen: WeakSet<object>, keyHint?: string): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value, keyHint);
  if (typeof value !== 'object') return value;

  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      output[key] = '[REDACTED]';
      continue;
    }
    output[key] = redactValue(entry, seen, key);
  }
  return output;
}

function redactString(value: string, keyHint?: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (keyHint && SENSITIVE_KEY_RE.test(keyHint)) return '[REDACTED]';
  if (SENSITIVE_VALUE_RE.test(trimmed)) return '[REDACTED]';
  const maskedUrl = redactUrl(trimmed);
  if (maskedUrl) return maskedUrl;
  if (trimmed.length > 400) return `${trimmed.slice(0, 200)}...<truncated>`;
  return trimmed;
}

function redactUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.search) parsed.search = '?REDACTED';
    if (parsed.username || parsed.password) {
      parsed.username = 'REDACTED';
      parsed.password = 'REDACTED';
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}
