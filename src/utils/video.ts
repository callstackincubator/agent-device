import fs from 'node:fs';
import { runCmd } from './exec.ts';

const VIDEO_VALIDATION_SCRIPT = `
import Foundation
import AVFoundation

let url = URL(fileURLWithPath: CommandLine.arguments[1])
let asset = AVURLAsset(url: url)
let semaphore = DispatchSemaphore(value: 0)
var exitCode: Int32 = 1

Task {
  defer { semaphore.signal() }
  do {
    let playable = try await asset.load(.isPlayable)
    let duration = try await asset.load(.duration)
    if playable && duration.isValid && !duration.isIndefinite && CMTimeGetSeconds(duration) > 0 {
      exitCode = 0
    }
  } catch {
    exitCode = 1
  }
}

semaphore.wait()
exit(exitCode)
`.trim();

export async function waitForStableFile(
  filePath: string,
  options: { pollMs?: number; attempts?: number } = {},
): Promise<void> {
  const pollMs = options.pollMs ?? 150;
  const attempts = options.attempts ?? 12;
  let previousSize: number | undefined;
  let stableCount = 0;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let currentSize = 0;
    try {
      currentSize = fs.statSync(filePath).size;
    } catch {
      currentSize = 0;
    }

    if (currentSize > 0 && currentSize === previousSize) {
      stableCount += 1;
      if (stableCount >= 2) {
        return;
      }
    } else {
      stableCount = 0;
    }

    previousSize = currentSize;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export async function isPlayableVideo(filePath: string): Promise<boolean> {
  const result = await runCmd('swift', ['-', filePath], {
    stdin: VIDEO_VALIDATION_SCRIPT,
    allowFailure: true,
    timeoutMs: 10_000,
  });
  return result.exitCode === 0;
}

export async function waitForPlayableVideo(
  filePath: string,
  options: { pollMs?: number; attempts?: number } = {},
): Promise<void> {
  const pollMs = options.pollMs ?? 150;
  const attempts = options.attempts ?? 12;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await isPlayableVideo(filePath)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
