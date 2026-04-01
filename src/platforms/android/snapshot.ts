import { runCmd } from '../../utils/exec.ts';
import { withRetry } from '../../utils/retry.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import type { RawSnapshotNode, SnapshotOptions } from '../../utils/snapshot.ts';
import { parseUiHierarchy, type AndroidSnapshotAnalysis } from './ui-hierarchy.ts';
import { adbArgs } from './adb.ts';

export async function snapshotAndroid(
  device: DeviceInfo,
  options: SnapshotOptions = {},
): Promise<{
  nodes: RawSnapshotNode[];
  truncated?: boolean;
  analysis: AndroidSnapshotAnalysis;
}> {
  const xml = options.waitStableMs
    ? await dumpUiHierarchyStable(device, options.waitStableMs)
    : await dumpUiHierarchy(device);
  return parseUiHierarchy(xml, 800, options);
}

/**
 * Poll until the AX tree stabilizes: two consecutive dumps produce identical XML,
 * or the timeout is reached. Returns the last captured XML.
 */
async function dumpUiHierarchyStable(device: DeviceInfo, timeoutMs: number): Promise<string> {
  const POLL_INTERVAL = 200;
  const start = Date.now();
  let previousXml = await dumpUiHierarchy(device);
  while (Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    const currentXml = await dumpUiHierarchy(device);
    if (currentXml === previousXml) {
      return currentXml;
    }
    previousXml = currentXml;
  }
  // Timeout reached — return the last dump even though it may still be changing.
  return previousXml;
}

export async function dumpUiHierarchy(device: DeviceInfo): Promise<string> {
  return withRetry(() => dumpUiHierarchyOnce(device), {
    shouldRetry: isRetryableAdbError,
  });
}

async function dumpUiHierarchyOnce(device: DeviceInfo): Promise<string> {
  // Preferred: stream XML directly to stdout, avoiding file I/O race conditions.
  const streamed = await runCmd(
    'adb',
    adbArgs(device, ['exec-out', 'uiautomator', 'dump', '/dev/tty']),
    { allowFailure: true },
  );
  const fromStream = extractUiDumpXml(streamed.stdout, streamed.stderr);
  if (fromStream) return fromStream;

  // Fallback: dump to file and read back.
  // If `cat` fails with "no such file", the outer withRetry (via isRetryableAdbError) handles it.
  const dumpPath = '/sdcard/window_dump.xml';
  const dumpResult = await runCmd(
    'adb',
    adbArgs(device, ['shell', 'uiautomator', 'dump', dumpPath]),
    { allowFailure: true },
  );
  const actualPath = resolveDumpPath(dumpPath, dumpResult.stdout, dumpResult.stderr);

  const result = await runCmd('adb', adbArgs(device, ['shell', 'cat', actualPath]));
  const xml = extractUiDumpXml(result.stdout, result.stderr);
  if (!xml) {
    throw new AppError('COMMAND_FAILED', 'uiautomator dump did not return XML', {
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
  return xml;
}

function resolveDumpPath(defaultPath: string, stdout: string, stderr: string): string {
  const text = `${stdout}\n${stderr}`;
  const match = /dumped to:\s*(\S+)/i.exec(text);
  return match?.[1] ?? defaultPath;
}

function extractUiDumpXml(stdout: string, stderr: string): string | null {
  const text = `${stdout}\n${stderr}`;
  const start = text.indexOf('<?xml');
  const hierarchyStart = start >= 0 ? start : text.indexOf('<hierarchy');
  if (hierarchyStart < 0) return null;
  const end = text.lastIndexOf('</hierarchy>');
  if (end < 0 || end < hierarchyStart) return null;
  const xml = text.slice(hierarchyStart, end + '</hierarchy>'.length).trim();
  return xml.length > 0 ? xml : null;
}

function isRetryableAdbError(err: unknown): boolean {
  if (!(err instanceof AppError)) return false;
  if (err.code !== 'COMMAND_FAILED') return false;
  const stderr = `${(err.details as any)?.stderr ?? ''}`.toLowerCase();
  if (stderr.includes('device offline')) return true;
  if (stderr.includes('device not found')) return true;
  if (stderr.includes('transport error')) return true;
  if (stderr.includes('connection reset')) return true;
  if (stderr.includes('broken pipe')) return true;
  if (stderr.includes('timed out')) return true;
  if (stderr.includes('no such file or directory')) return true;
  return false;
}
