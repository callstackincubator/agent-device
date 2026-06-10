import { parentPort } from 'node:worker_threads';
import { PNG } from './png-codec.ts';
import { computeScreenshotDiffPixels } from './screenshot-diff-pixels.ts';
import type {
  PngWorkerJobResult,
  PngWorkerRequest,
  PngWorkerResponse,
} from './png-worker-contract.ts';

/**
 * Worker thread entry that runs CPU-heavy PNG decode/encode and screenshot
 * pixel-diff jobs off the daemon event loop. Spawned lazily by
 * `png-worker-client.ts`; published as the `internal/png-worker` build entry.
 */

function toBuffer(view: Uint8Array): Buffer {
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

function runJob(request: PngWorkerRequest): PngWorkerJobResult {
  switch (request.kind) {
    case 'decode': {
      const png = PNG.sync.read(toBuffer(request.png));
      return { kind: 'decode', width: png.width, height: png.height, data: png.data };
    }
    case 'encode': {
      const png = new PNG({
        width: request.width,
        height: request.height,
        data: toBuffer(request.data),
      });
      return { kind: 'encode', png: PNG.sync.write(png) };
    }
    case 'diff-pixels': {
      const result = computeScreenshotDiffPixels({
        width: request.width,
        height: request.height,
        baselineData: request.baselineData,
        currentData: request.currentData,
        maxColorDistance: request.maxColorDistance,
      });
      return {
        kind: 'diff-pixels',
        diffData: result.diffData,
        diffMask: result.diffMask,
        differentPixels: result.differentPixels,
      };
    }
  }
}

const port = parentPort;
if (port) {
  port.on('message', (request: PngWorkerRequest) => {
    let response: PngWorkerResponse;
    try {
      response = { id: request.id, ok: true, result: runJob(request) };
    } catch (error) {
      response = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    port.postMessage(response);
  });
}
