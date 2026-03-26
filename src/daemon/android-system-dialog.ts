import { openAndroidApp, snapshotAndroid, getAndroidAppState } from '../platforms/android/index.ts';
import { adbArgs } from '../platforms/android/adb.ts';
import { runCmd } from '../utils/exec.ts';
import { emitDiagnostic } from '../utils/diagnostics.ts';
import { centerOfRect, attachRefs, type SnapshotNode } from '../utils/snapshot.ts';
import { pruneGroupNodes } from './snapshot-processing.ts';
import type { SessionState } from './types.ts';

const ANDROID_BLOCKING_MODAL_PATTERN = /\bis(?:n't| not)\s+responding\b/i;
const ANDROID_CLOSE_APP_PATTERN = /^close app$/i;
const ANDROID_MODAL_POLL_MS = 500;
const ANDROID_MODAL_POLL_ATTEMPTS = 12;

export type AndroidBlockingDialogRecoveryResult = 'absent' | 'recovered' | 'failed';

export async function recoverAndroidBlockingSystemDialog(params: {
  session: SessionState;
}): Promise<AndroidBlockingDialogRecoveryResult> {
  const { session } = params;

  if (session.device.platform !== 'android' || !session.recording) {
    return 'absent';
  }

  try {
    const nodes = await readAndroidSnapshotNodes(session);
    const closeAppButton = findCloseAppButton(nodes);
    if (!closeAppButton?.rect) {
      return 'absent';
    }

    const { x, y } = centerOfRect(closeAppButton.rect);
    const tapResult = await runCmd(
      'adb',
      adbArgs(session.device, [
        'shell',
        'input',
        'tap',
        String(Math.round(x)),
        String(Math.round(y)),
      ]),
      { allowFailure: true },
    );
    if (tapResult.exitCode !== 0) {
      emitDiagnostic({
        level: 'warn',
        phase: 'android_blocking_dialog_tap_failed',
        data: {
          session: session.name,
          deviceId: session.device.id,
          exitCode: tapResult.exitCode,
          stdout: tapResult.stdout.trim(),
          stderr: tapResult.stderr.trim(),
        },
      });
      return 'failed';
    }

    const dismissed = await waitForBlockingDialogToDismiss(session);
    if (!dismissed) {
      emitDiagnostic({
        level: 'warn',
        phase: 'android_blocking_dialog_still_present',
        data: {
          session: session.name,
          deviceId: session.device.id,
        },
      });
      return 'failed';
    }

    if (session.appBundleId) {
      await openAndroidApp(session.device, session.appBundleId);
      const focused = await waitForFocusedAndroidApp(session, session.appBundleId);
      if (!focused) {
        emitDiagnostic({
          level: 'warn',
          phase: 'android_blocking_dialog_relaunch_unfocused',
          data: {
            session: session.name,
            deviceId: session.device.id,
            appBundleId: session.appBundleId,
          },
        });
        return 'failed';
      }
    }

    emitDiagnostic({
      level: 'warn',
      phase: 'android_blocking_dialog_recovered',
      data: {
        session: session.name,
        deviceId: session.device.id,
        appBundleId: session.appBundleId,
        x,
        y,
      },
    });
    return 'recovered';
  } catch (error) {
    emitDiagnostic({
      level: 'warn',
      phase: 'android_blocking_dialog_recovery_failed',
      data: {
        session: session.name,
        deviceId: session.device.id,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return 'failed';
  }
}

async function readAndroidSnapshotNodes(session: SessionState): Promise<SnapshotNode[]> {
  const rawSnapshot = await snapshotAndroid(session.device, {
    interactiveOnly: false,
    compact: false,
  });
  return attachRefs(pruneGroupNodes(rawSnapshot.nodes));
}

function findCloseAppButton(nodes: SnapshotNode[]): SnapshotNode | undefined {
  if (!containsBlockingDialog(nodes)) {
    return undefined;
  }
  return nodes.find((node) => {
    const text = readNodeText(node);
    return text.length > 0 && ANDROID_CLOSE_APP_PATTERN.test(text) && node.rect;
  });
}

async function waitForBlockingDialogToDismiss(session: SessionState): Promise<boolean> {
  for (let attempt = 0; attempt < ANDROID_MODAL_POLL_ATTEMPTS; attempt += 1) {
    const nodes = await readAndroidSnapshotNodes(session);
    if (!containsBlockingDialog(nodes)) {
      return true;
    }
    await sleep(ANDROID_MODAL_POLL_MS);
  }
  const nodes = await readAndroidSnapshotNodes(session);
  return !containsBlockingDialog(nodes);
}

async function waitForFocusedAndroidApp(
  session: SessionState,
  appBundleId: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < ANDROID_MODAL_POLL_ATTEMPTS; attempt += 1) {
    const state = await getAndroidAppState(session.device);
    if (state.package === appBundleId) {
      return true;
    }
    await sleep(ANDROID_MODAL_POLL_MS);
  }
  const state = await getAndroidAppState(session.device);
  return state.package === appBundleId;
}

function readNodeText(node: {
  label?: string;
  value?: string | number | boolean | null;
  identifier?: string;
}): string {
  const parts = [node.label, node.identifier];
  if (typeof node.value === 'string' && node.value.trim().length > 0) {
    parts.push(node.value);
  }
  return parts
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();
}

function containsBlockingDialog(nodes: SnapshotNode[]): boolean {
  return nodes.some((node) => {
    const text = readNodeText(node);
    return text.length > 0 && ANDROID_BLOCKING_MODAL_PATTERN.test(text);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
