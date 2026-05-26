import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DaemonResponse, SessionState } from './types.ts';
import { dispatchCommand } from '../core/dispatch.ts';
import { emitDiagnostic } from '../utils/diagnostics.ts';
import { normalizeError } from '../utils/errors.ts';
import { contextFromFlags } from './context.ts';
import { annotateScreenshotWithRefs } from './screenshot-overlay.ts';

type AndroidSnapshotTimeoutEvidence = {
  path?: string;
  overlayRefsRequested?: boolean;
  overlayRefsAnnotated?: boolean;
  overlayRefCount?: number;
  overlayRefSource?: 'session-snapshot' | 'unavailable';
  overlayRefs?: unknown[];
  overlayAnnotationError?: string;
  captureFailed?: boolean;
  error?: string;
};

export async function maybeBuildAndroidSnapshotTimeoutFailure(params: {
  error: unknown;
  command: 'snapshot' | 'diff';
  logPath: string;
  session: SessionState | undefined;
  device: SessionState['device'];
}): Promise<Extract<DaemonResponse, { ok: false }> | undefined> {
  if (params.command !== 'snapshot') return undefined;
  if (params.device.platform !== 'android') return undefined;
  if (!isAndroidSnapshotTimeoutError(params.error)) return undefined;

  const normalized = normalizeError(params.error);
  return {
    ok: false,
    error: {
      ...normalized,
      details: {
        ...(normalized.details ?? {}),
        androidSnapshotTimeoutScreenshot: await captureAndroidSnapshotTimeoutEvidence(params),
      },
    },
  };
}

async function captureAndroidSnapshotTimeoutEvidence(params: {
  logPath: string;
  session: SessionState | undefined;
  device: SessionState['device'];
}): Promise<AndroidSnapshotTimeoutEvidence> {
  try {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'agent-device-android-snapshot-timeout-'),
    );
    const screenshotPath = path.join(tempDir, 'snapshot-timeout-overlay-refs.png');
    const data = await dispatchCommand(params.device, 'screenshot', [screenshotPath], undefined, {
      ...contextFromFlags(
        params.logPath,
        { screenshotNoStabilize: true },
        params.session?.appBundleId,
        params.session?.trace?.outPath,
      ),
      surface: params.session?.surface,
    });
    const resolvedPath = resolveCapturedScreenshotPath(data, screenshotPath);
    const evidence = await annotateAndroidSnapshotTimeoutEvidence(resolvedPath, params.session);

    emitDiagnostic({
      level: 'warn',
      phase: 'android_snapshot_timeout_screenshot_captured',
      data: {
        path: resolvedPath,
        overlayRefCount: evidence.overlayRefCount,
        overlayRefsAnnotated: evidence.overlayRefsAnnotated,
      },
    });
    return evidence;
  } catch (error) {
    const normalized = normalizeError(error);
    emitDiagnostic({
      level: 'warn',
      phase: 'android_snapshot_timeout_screenshot_failed',
      data: { error: normalized.message },
    });
    return {
      captureFailed: true,
      error: normalized.message,
    };
  }
}

async function annotateAndroidSnapshotTimeoutEvidence(
  screenshotPath: string,
  session: SessionState | undefined,
): Promise<AndroidSnapshotTimeoutEvidence> {
  const evidence: AndroidSnapshotTimeoutEvidence = {
    path: screenshotPath,
    overlayRefsRequested: true,
    overlayRefsAnnotated: false,
  };

  if (!session?.snapshot) {
    return {
      ...evidence,
      overlayRefSource: 'unavailable',
      overlayRefCount: 0,
    };
  }

  try {
    const overlayRefs = await annotateScreenshotWithRefs({
      screenshotPath,
      snapshot: session.snapshot,
    });
    return {
      ...evidence,
      overlayRefsAnnotated: overlayRefs.length > 0,
      overlayRefCount: overlayRefs.length,
      overlayRefSource: 'session-snapshot',
      overlayRefs,
    };
  } catch (error) {
    const normalized = normalizeError(error);
    emitDiagnostic({
      level: 'warn',
      phase: 'android_snapshot_timeout_screenshot_overlay_failed',
      data: { path: screenshotPath, error: normalized.message },
    });
    return {
      ...evidence,
      overlayAnnotationError: normalized.message,
    };
  }
}

function resolveCapturedScreenshotPath(data: unknown, fallbackPath: string): string {
  return typeof data === 'object' &&
    data !== null &&
    typeof (data as Record<string, unknown>).path === 'string'
    ? ((data as Record<string, unknown>).path as string)
    : fallbackPath;
}

function isAndroidSnapshotTimeoutError(error: unknown): boolean {
  const normalized = normalizeError(error);
  if (normalized.code !== 'COMMAND_FAILED') return false;

  const text = `${normalized.message}\n${normalized.hint ?? ''}`;
  if (/Android UI hierarchy dump timed out/i.test(text)) return true;
  if (/Stock UIAutomator fallback was skipped/i.test(text)) return true;
  if (/Android accessibility snapshots can be blocked/i.test(text)) return true;

  const details = normalized.details;
  const helper = details?.helper;
  if (helper && typeof helper === 'object') {
    const helperRecord = helper as Record<string, unknown>;
    const errorType = String(helperRecord.errorType ?? '');
    const message = String(helperRecord.message ?? '');
    if (/TimeoutException/i.test(errorType) || /timed out/i.test(message)) return true;
  }

  const timeoutMs = details?.timeoutMs;
  const cmd = details?.cmd;
  const rawArgs = details?.args;
  const args = Array.isArray(rawArgs)
    ? rawArgs.map(String)
    : typeof rawArgs === 'string'
      ? rawArgs.split(/\s+/)
      : [];
  return (
    typeof timeoutMs === 'number' &&
    cmd === 'adb' &&
    args.includes('uiautomator') &&
    args.includes('dump')
  );
}
