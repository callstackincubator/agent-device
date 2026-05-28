import { AsyncLocalStorage } from 'node:async_hooks';

export type ReplayTestProgressEvent = {
  type: 'replay-test';
  file: string;
  status: 'pass' | 'fail' | 'skip';
  index: number;
  total: number;
  attempt?: number;
  maxAttempts?: number;
  durationMs?: number;
  retrying?: boolean;
  message?: string;
  artifactsDir?: string;
};

export type RequestProgressEvent = ReplayTestProgressEvent;
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
