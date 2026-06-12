import { AsyncLocalStorage } from 'node:async_hooks';

export type ReplayTestSuiteProgressEvent = {
  type: 'replay-test-suite';
  status: 'start';
  total: number;
  runnable: number;
  skipped: number;
  artifactsDir: string;
  shardMode?: 'all' | 'split';
  shardCount?: number;
};

export type ReplayTestProgressEvent = {
  type: 'replay-test';
  file: string;
  title?: string;
  status: 'start' | 'pass' | 'fail' | 'skip';
  index: number;
  total: number;
  attempt?: number;
  maxAttempts?: number;
  durationMs?: number;
  retrying?: boolean;
  message?: string;
  session?: string;
  artifactsDir?: string;
  shardIndex?: number;
  shardCount?: number;
  deviceId?: string;
};

export type RequestProgressEvent = ReplayTestSuiteProgressEvent | ReplayTestProgressEvent;
export type RequestProgressSink = (event: RequestProgressEvent) => void;

const requestProgress = new AsyncLocalStorage<RequestProgressSink | undefined>();

export async function withRequestProgressSink<T>(
  sink: RequestProgressSink | undefined,
  run: () => Promise<T>,
): Promise<T> {
  return await requestProgress.run(sink, run);
}

export function emitRequestProgress(event: RequestProgressEvent): void {
  requestProgress.getStore()?.(event);
}
