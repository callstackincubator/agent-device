import { AppError } from './errors.ts';

type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
};

export type RetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
};

export type RetryAttemptContext = {
  attempt: number;
  maxAttempts: number;
  deadline?: Deadline;
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
  options: { deadline?: Deadline } = {},
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
      return await fn({ attempt, maxAttempts: merged.maxAttempts, deadline: options.deadline });
    } catch (err) {
      lastError = err;
      if (attempt >= merged.maxAttempts) break;
      if (merged.shouldRetry && !merged.shouldRetry(err, attempt)) break;
      const delay = computeDelay(merged.baseDelayMs, merged.maxDelayMs, merged.jitter, attempt);
      const boundedDelay = options.deadline ? Math.min(delay, options.deadline.remainingMs()) : delay;
      if (boundedDelay <= 0) break;
      await sleep(boundedDelay);
    }
  }
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
