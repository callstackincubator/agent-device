/**
 * Message contract between the daemon-side PNG worker client
 * (`png-worker-client.ts`) and the worker thread entry (`png-worker.ts`).
 * One message = one decode, encode, or diff job. Binary payloads cross the
 * thread boundary via structured clone, so `Buffer` fields arrive as plain
 * `Uint8Array` views on the receiving side.
 */

export type PngWorkerJob =
  | { kind: 'decode'; png: Uint8Array }
  | { kind: 'encode'; width: number; height: number; data: Uint8Array }
  | {
      kind: 'diff-pixels';
      width: number;
      height: number;
      baselineData: Uint8Array;
      currentData: Uint8Array;
      maxColorDistance: number;
    };

export type PngWorkerJobResult =
  | { kind: 'decode'; width: number; height: number; data: Uint8Array }
  | { kind: 'encode'; png: Uint8Array }
  | { kind: 'diff-pixels'; diffData: Uint8Array; diffMask: Uint8Array; differentPixels: number };

export type PngWorkerRequest = PngWorkerJob & { id: number };

export type PngWorkerResponse =
  | { id: number; ok: true; result: PngWorkerJobResult }
  | { id: number; ok: false; error: string };
