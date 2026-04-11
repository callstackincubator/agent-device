const SENSITIVE_KEY_RE =
  /(token|secret|password|authorization|cookie|api[_-]?key|access[_-]?key|private[_-]?key)/i;
const SENSITIVE_VALUE_RE =
  /(bearer\s+[a-z0-9._-]+|(?:api[_-]?key|token|secret|password)\s*[=:]\s*\S+)/i;

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
