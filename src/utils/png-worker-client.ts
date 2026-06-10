import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { AppError } from './errors.ts';
import { PNG } from './png-codec.ts';
import { decodePng } from './png.ts';
import {
  computeScreenshotDiffPixels,
  type ScreenshotDiffPixelsJob,
  type ScreenshotDiffPixelsResult,
} from './screenshot-diff-pixels.ts';
import type { PngWorkerJob, PngWorkerJobResult, PngWorkerResponse } from './png-worker-contract.ts';

/**
 * Async wrappers that offload CPU-heavy PNG decode/encode and screenshot
 * pixel diffing to a worker thread so daemon request handlers do not block
 * the shared event loop. When the worker entry cannot be resolved or fails
 * to start, every call transparently falls back to the in-process
 * synchronous implementation, producing byte-identical results.
 */

const PNG_WORKER_ENTRYPOINT = 'png-worker';

/** Worker-infrastructure failure: callers fall back to the sync path. */
class PngWorkerUnavailableError extends Error {}
/** Job-level failure inside the worker (e.g. corrupt PNG): rethrown to callers. */
class PngWorkerJobError extends Error {}

type PendingJob = {
  resolve: (result: PngWorkerJobResult) => void;
  reject: (error: Error) => void;
};

let worker: Worker | null = null;
let workerUnavailable = false;
let nextJobId = 0;
const pendingJobs = new Map<number, PendingJob>();

function resolvePngWorkerModulePath(): string | null {
  const currentModulePath = fileURLToPath(import.meta.url);
  const extension = path.extname(currentModulePath) || '.js';
  const candidates = [
    path.join(path.dirname(currentModulePath), `${PNG_WORKER_ENTRYPOINT}${extension}`),
    path.join(path.dirname(currentModulePath), 'internal', `${PNG_WORKER_ENTRYPOINT}${extension}`),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function handleWorkerMessage(message: PngWorkerResponse): void {
  const pending = pendingJobs.get(message.id);
  if (!pending) return;
  pendingJobs.delete(message.id);
  updateWorkerRef();
  if (message.ok) {
    pending.resolve(message.result);
  } else {
    pending.reject(new PngWorkerJobError(message.error));
  }
}

function handleWorkerFailure(failed: Worker, error: Error): void {
  if (worker !== failed) return;
  // Keep the failure handling conservative: after any worker-level error the
  // daemon permanently falls back to the in-process synchronous path.
  workerUnavailable = true;
  worker = null;
  void failed.terminate().catch(() => {});
  rejectPendingJobs(new PngWorkerUnavailableError(`PNG worker failed: ${error.message}`));
}

function rejectPendingJobs(error: Error): void {
  const pending = [...pendingJobs.values()];
  pendingJobs.clear();
  for (const job of pending) {
    job.reject(error);
  }
}

function updateWorkerRef(): void {
  if (!worker) return;
  if (pendingJobs.size > 0) {
    worker.ref();
  } else {
    worker.unref();
  }
}

function obtainWorker(): Worker | null {
  if (workerUnavailable) return null;
  if (worker) return worker;
  const modulePath = resolvePngWorkerModulePath();
  if (!modulePath) {
    workerUnavailable = true;
    return null;
  }
  try {
    const created = new Worker(modulePath, { execArgv: [] });
    created.on('message', handleWorkerMessage);
    created.on('error', (error) => {
      handleWorkerFailure(created, error);
    });
    created.on('exit', (code) => {
      handleWorkerFailure(created, new Error(`PNG worker exited with code ${code}`));
    });
    created.unref();
    worker = created;
    return created;
  } catch {
    workerUnavailable = true;
    return null;
  }
}

/** Returns null when the worker is unavailable so callers run the sync path. */
function runWorkerJob(job: PngWorkerJob): Promise<PngWorkerJobResult> | null {
  const activeWorker = obtainWorker();
  if (!activeWorker) return null;
  nextJobId += 1;
  const id = nextJobId;
  return new Promise<PngWorkerJobResult>((resolve, reject) => {
    pendingJobs.set(id, { resolve, reject });
    updateWorkerRef();
    activeWorker.postMessage({ ...job, id });
  });
}

function isWorkerUnavailableError(error: unknown): error is PngWorkerUnavailableError {
  return error instanceof PngWorkerUnavailableError;
}

function toBuffer(view: Uint8Array): Buffer {
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

/** Stops the worker thread (used by tests and shutdown); later calls respawn it. */
export async function terminatePngWorker(): Promise<void> {
  const active = worker;
  worker = null;
  rejectPendingJobs(new PngWorkerUnavailableError('PNG worker terminated'));
  if (active) {
    await active.terminate();
  }
}

export async function decodePngAsync(buffer: Buffer, label: string): Promise<PNG> {
  const pendingResult = runWorkerJob({ kind: 'decode', png: buffer });
  if (!pendingResult) return decodePng(buffer, label);
  let result: PngWorkerJobResult;
  try {
    result = await pendingResult;
  } catch (error) {
    if (isWorkerUnavailableError(error)) return decodePng(buffer, label);
    throw new AppError('COMMAND_FAILED', `Failed to decode ${label} as PNG`, {
      label,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  if (result.kind !== 'decode') {
    throw new AppError('COMMAND_FAILED', 'PNG worker returned a mismatched decode result');
  }
  return new PNG({ width: result.width, height: result.height, data: toBuffer(result.data) });
}

export async function encodePngAsync(png: PNG): Promise<Buffer> {
  const pendingResult = runWorkerJob({
    kind: 'encode',
    width: png.width,
    height: png.height,
    data: png.data,
  });
  if (!pendingResult) return PNG.sync.write(png);
  let result: PngWorkerJobResult;
  try {
    result = await pendingResult;
  } catch (error) {
    if (isWorkerUnavailableError(error)) return PNG.sync.write(png);
    throw error;
  }
  if (result.kind !== 'encode') {
    throw new AppError('COMMAND_FAILED', 'PNG worker returned a mismatched encode result');
  }
  return toBuffer(result.png);
}

export async function computeScreenshotDiffPixelsAsync(
  job: ScreenshotDiffPixelsJob,
): Promise<ScreenshotDiffPixelsResult> {
  const pendingResult = runWorkerJob({
    kind: 'diff-pixels',
    width: job.width,
    height: job.height,
    baselineData: job.baselineData,
    currentData: job.currentData,
    maxColorDistance: job.maxColorDistance,
  });
  if (!pendingResult) return computeScreenshotDiffPixels(job);
  let result: PngWorkerJobResult;
  try {
    result = await pendingResult;
  } catch (error) {
    if (isWorkerUnavailableError(error)) return computeScreenshotDiffPixels(job);
    throw error;
  }
  if (result.kind !== 'diff-pixels') {
    throw new AppError('COMMAND_FAILED', 'PNG worker returned a mismatched diff result');
  }
  return {
    diffData: toBuffer(result.diffData),
    diffMask: result.diffMask,
    differentPixels: result.differentPixels,
  };
}
