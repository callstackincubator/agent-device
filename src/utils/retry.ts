import { AppError } from './errors.ts';
import { emitDiagnostic } from './diagnostics.ts';

type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
};

type RetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
};

type RetryAttemptContext = {
  attempt: number;
  maxAttempts: number;
  deadline?: Deadline;
};

type TimeoutProfile = {
  startupMs: number;
  operationMs: number;
  totalMs: number;
};

type RetryTelemetryEvent = {
  phase?: string;
  event: 'attempt_failed' | 'retry_scheduled' | 'succeeded' | 'exhausted';
  attempt: number;
  maxAttempts: number;
  delayMs?: number;
  elapsedMs?: number;
  remainingMs?: number;
  reason?: string;
};

const RETRY_LOGS_ENABLED = isEnvTruthy(process.env.AGENT_DEVICE_RETRY_LOGS);

export function isEnvTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').toLowerCase());
}

export const TIMEOUT_PROFILES: Record<string, TimeoutProfile> = {
  ios_boot: { startupMs: 120_000, operationMs: 20_000, totalMs: 120_000 },
  ios_runner_connect: { startupMs: 120_000, operationMs: 15_000, totalMs: 120_000 },
  android_boot: { startupMs: 60_000, operationMs: 10_000, totalMs: 60_000 },
};

const defaultOptions: Required<Pick<RetryOptions, 'attempts' | 'baseDelayMs' | 'maxDelayMs' | 'jitter'>> = {
  attempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 2000,
  jitter: 0.2,
};

export class Deadline {
  private readonly startedAtMs: number;
  private readonly expiresAtMs: number;

  private constructor(startedAtMs: number, timeoutMs: number) {
    this.startedAtMs = startedAtMs;
    this.expiresAtMs = startedAtMs + Math.max(0, timeoutMs);
  }

  static fromTimeoutMs(timeoutMs: number, nowMs = Date.now()): Deadline {
    return new Deadline(nowMs, timeoutMs);
  }

  remainingMs(nowMs = Date.now()): number {
    return Math.max(0, this.expiresAtMs - nowMs);
  }

  elapsedMs(nowMs = Date.now()): number {
    return Math.max(0, nowMs - this.startedAtMs);
  }

  isExpired(nowMs = Date.now()): boolean {
    return this.remainingMs(nowMs) <= 0;
  }
}

export async function retryWithPolicy<T>(
  fn: (context: RetryAttemptContext) => Promise<T>,
  policy: Partial<RetryPolicy> = {},
  options: {
    deadline?: Deadline;
    phase?: string;
    classifyReason?: (error: unknown) => string | undefined;
    onEvent?: (event: RetryTelemetryEvent) => void;
  } = {},
): Promise<T> {
  const merged: RetryPolicy = {
    maxAttempts: policy.maxAttempts ?? defaultOptions.attempts,
    baseDelayMs: policy.baseDelayMs ?? defaultOptions.baseDelayMs,
    maxDelayMs: policy.maxDelayMs ?? defaultOptions.maxDelayMs,
    jitter: policy.jitter ?? defaultOptions.jitter,
    shouldRetry: policy.shouldRetry,
  };
  let lastError: unknown;
  for (let attempt = 1; attempt <= merged.maxAttempts; attempt += 1) {
    if (options.deadline?.isExpired() && attempt > 1) break;
    try {
      const result = await fn({ attempt, maxAttempts: merged.maxAttempts, deadline: options.deadline });
      options.onEvent?.({
        phase: options.phase,
        event: 'succeeded',
        attempt,
        maxAttempts: merged.maxAttempts,
        elapsedMs: options.deadline?.elapsedMs(),
        remainingMs: options.deadline?.remainingMs(),
      });
      publishRetryEvent({
        phase: options.phase,
        event: 'succeeded',
        attempt,
        maxAttempts: merged.maxAttempts,
        elapsedMs: options.deadline?.elapsedMs(),
        remainingMs: options.deadline?.remainingMs(),
      });
      return result;
    } catch (err) {
      lastError = err;
      const reason = options.classifyReason?.(err);
      const failedEvent: RetryTelemetryEvent = {
        phase: options.phase,
        event: 'attempt_failed',
        attempt,
        maxAttempts: merged.maxAttempts,
        elapsedMs: options.deadline?.elapsedMs(),
        remainingMs: options.deadline?.remainingMs(),
        reason,
      };
      options.onEvent?.(failedEvent);
      publishRetryEvent(failedEvent);
      if (attempt >= merged.maxAttempts) break;
      if (merged.shouldRetry && !merged.shouldRetry(err, attempt)) break;
      const delay = computeDelay(merged.baseDelayMs, merged.maxDelayMs, merged.jitter, attempt);
      const boundedDelay = options.deadline ? Math.min(delay, options.deadline.remainingMs()) : delay;
      if (boundedDelay <= 0) break;
      const retryEvent: RetryTelemetryEvent = {
        phase: options.phase,
        event: 'retry_scheduled',
        attempt,
        maxAttempts: merged.maxAttempts,
        delayMs: boundedDelay,
        elapsedMs: options.deadline?.elapsedMs(),
        remainingMs: options.deadline?.remainingMs(),
        reason,
      };
      options.onEvent?.(retryEvent);
      publishRetryEvent(retryEvent);
      await sleep(boundedDelay);
    }
  }
  const exhaustedEvent: RetryTelemetryEvent = {
    phase: options.phase,
    event: 'exhausted',
    attempt: merged.maxAttempts,
    maxAttempts: merged.maxAttempts,
    elapsedMs: options.deadline?.elapsedMs(),
    remainingMs: options.deadline?.remainingMs(),
    reason: options.classifyReason?.(lastError),
  };
  options.onEvent?.(exhaustedEvent);
  publishRetryEvent(exhaustedEvent);
  if (lastError) throw lastError;
  throw new AppError('COMMAND_FAILED', 'retry failed');
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  return retryWithPolicy(() => fn(), {
    maxAttempts: options.attempts,
    baseDelayMs: options.baseDelayMs,
    maxDelayMs: options.maxDelayMs,
    jitter: options.jitter,
    shouldRetry: options.shouldRetry,
  });
}

function computeDelay(base: number, max: number, jitter: number, attempt: number): number {
  const exp = Math.min(max, base * 2 ** (attempt - 1));
  const jitterAmount = exp * jitter;
  return Math.max(0, exp + (Math.random() * 2 - 1) * jitterAmount);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function publishRetryEvent(event: RetryTelemetryEvent): void {
  emitDiagnostic({
    level: event.event === 'attempt_failed' || event.event === 'exhausted' ? 'warn' : 'debug',
    phase: 'retry',
    data: {
      ...event,
    },
  });
  if (!RETRY_LOGS_ENABLED) return;
  process.stderr.write(`[agent-device][retry] ${JSON.stringify(event)}\n`);
}
