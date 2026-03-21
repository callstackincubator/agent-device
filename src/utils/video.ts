import fs from 'node:fs';
import { AppError } from './errors.ts';
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
  try {
    const result = await runCmd('swift', ['-', filePath], {
      stdin: VIDEO_VALIDATION_SCRIPT,
      allowFailure: true,
      timeoutMs: 10_000,
    });
    if (result.exitCode === 0) {
      return true;
    }
    if (isSwiftVideoValidatorUnavailable(result.stderr, result.stdout)) {
      return hasLikelyPlayableVideoContainer(filePath);
    }
    return false;
  } catch (error) {
    if (error instanceof AppError && error.code === 'TOOL_MISSING') {
      return hasLikelyPlayableVideoContainer(filePath);
    }
    throw error;
  }
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

function isSwiftVideoValidatorUnavailable(stderr: string, stdout: string): boolean {
  const combined = `${stderr}\n${stdout}`;
  return /\b(no such module ['"]AVFoundation['"]|unable to find utility ["']swift["']|xcrun: error: unable to find utility ["']swift["'])\b/i.test(
    combined,
  );
}

function hasLikelyPlayableVideoContainer(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size <= 0) {
      return false;
    }
  } catch {
    return false;
  }

  const atoms = inspectTopLevelAtoms(filePath);
  return atoms.includes('ftyp') && atoms.includes('moov');
}

function inspectTopLevelAtoms(filePath: string): string[] {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      let offset = 0;
      const atoms: string[] = [];
      while (offset + 8 <= size && atoms.length < 16) {
        const header = Buffer.alloc(8);
        const bytesRead = fs.readSync(fd, header, 0, 8, offset);
        if (bytesRead < 8) {
          break;
        }

        let atomSize = header.readUInt32BE(0);
        const atomType = header.toString('latin1', 4, 8);
        atoms.push(atomType);

        if (atomSize === 1) {
          const extended = Buffer.alloc(8);
          const extendedRead = fs.readSync(fd, extended, 0, 8, offset + 8);
          if (extendedRead < 8) {
            break;
          }
          atomSize = Number(extended.readBigUInt64BE(0));
        }

        if (!Number.isFinite(atomSize) || atomSize <= 0) {
          break;
        }
        offset += atomSize;
      }
      return atoms;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
}
