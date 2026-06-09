import type { AlertAction } from '../../alert-contract.ts';
import {
  ALERT_ACTION_RETRY_MS,
  ALERT_POLL_INTERVAL_MS,
  DEFAULT_ALERT_TIMEOUT_MS,
} from '../../alert-contract.ts';
import { AppError } from '../../utils/errors.ts';
import { withDiagnosticTimer } from '../../utils/diagnostics.ts';
import { successText } from '../../utils/success-text.ts';
import { sleep } from '../../utils/timeouts.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { pressBackHarmony, pressHarmony } from './input-actions.ts';
import { snapshotHarmony } from './snapshot.ts';
import type { SnapshotNode } from '../../utils/snapshot.ts';

export type HarmonyAlertInfo = {
  visible: boolean;
  title?: string;
  message?: string;
  buttons: HarmonyAlertButton[];
};

export type HarmonyAlertButton = {
  label: string;
  x: number;
  y: number;
};

export type HarmonyAlertCandidate = {
  alert: HarmonyAlertInfo;
  nodes: SnapshotNode[];
};

export type HarmonyAlertResult =
  | {
      kind: 'alertStatus';
      platform: 'harmonyos';
      action: 'get';
      alert: HarmonyAlertInfo | null;
      message?: string;
    }
  | {
      kind: 'alertWait';
      platform: 'harmonyos';
      action: 'wait';
      alert: HarmonyAlertInfo;
      waitedMs: number;
      message?: string;
    }
  | {
      kind: 'alertHandled';
      platform: 'harmonyos';
      action: 'accept' | 'dismiss';
      handled: true;
      alert: HarmonyAlertInfo;
      button: string;
      message?: string;
    };

export async function handleHarmonyAlert(
  device: DeviceInfo,
  action: AlertAction,
  options: { timeoutMs?: number } = {},
): Promise<HarmonyAlertResult> {
  if (action === 'wait') {
    return await waitForHarmonyAlert(device, options.timeoutMs ?? DEFAULT_ALERT_TIMEOUT_MS);
  }
  if (action === 'get') {
    const candidate = await readHarmonyAlertCandidate(device);
    return buildHarmonyAlertStatusResponse(candidate?.alert ?? null);
  }
  return await handleHarmonyAlertAction(device, action);
}

async function waitForHarmonyAlert(
  device: DeviceInfo,
  timeoutMs: number,
): Promise<HarmonyAlertResult> {
  const start = Date.now();
  const candidate = await pollHarmonyAlertCandidate(device, timeoutMs);
  if (!candidate) {
    throw new AppError('COMMAND_FAILED', 'alert wait timed out');
  }
  return {
    kind: 'alertWait',
    platform: 'harmonyos',
    action: 'wait',
    alert: candidate.alert,
    waitedMs: Date.now() - start,
    ...successText('Alert visible'),
  };
}

async function handleHarmonyAlertAction(
  device: DeviceInfo,
  action: 'accept' | 'dismiss',
): Promise<HarmonyAlertResult> {
  const candidate = await pollHarmonyAlertCandidate(device, ALERT_ACTION_RETRY_MS);
  if (!candidate) {
    throw new AppError('COMMAND_FAILED', 'alert not found', {
      hint: 'If a sheet is visible in snapshot but alert reports no alert, it is likely app-owned UI. Use snapshot -i and press the visible label/ref.',
    });
  }

  const button = chooseHarmonyAlertButton(candidate.alert.buttons, action);
  if (button) {
    await pressHarmony(device, button.x, button.y);
    return buildHarmonyAlertHandledResponse(action, candidate.alert, button.label);
  }

  if (action === 'dismiss') {
    await pressBackHarmony(device);
    return buildHarmonyAlertHandledResponse(action, candidate.alert, 'Back');
  }

  throw new AppError('COMMAND_FAILED', 'alert accept found an alert but no accept button', {
    alert: candidate.alert,
    hint: 'Inspect alert get --json for visible buttons, then use press by visible label/ref if needed.',
  });
}

async function pollHarmonyAlertCandidate(
  device: DeviceInfo,
  timeoutMs: number,
): Promise<HarmonyAlertCandidate | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const candidate = await readHarmonyAlertCandidate(device);
    if (candidate) return candidate;
    await sleep(ALERT_POLL_INTERVAL_MS);
  }
  return null;
}

async function readHarmonyAlertCandidate(
  device: DeviceInfo,
): Promise<HarmonyAlertCandidate | null> {
  try {
    const result = await withDiagnosticTimer(
      'snapshot_capture',
      async () => await snapshotHarmony(device, {}),
      { backend: 'harmonyos-arkui', purpose: 'alert' },
    );
    return findHarmonyAlertCandidate(result.nodes);
  } catch {
    return null;
  }
}

function findHarmonyAlertCandidate(nodes: SnapshotNode[]): HarmonyAlertCandidate | null {
  // HarmonyOS alert detection: look for dialog/alert-like components
  // Common alert patterns: Dialog, AlertDialog, Popup, Toast, Sheet
  // System-specific patterns: "暂无可用打开方式", notification/privacy dialogs
  const alertCandidates: SnapshotNode[] = [];

  // First pass: find dialog containers
  for (const node of nodes) {
    const type = node.type?.toLowerCase() ?? '';
    const label = node.label?.toLowerCase() ?? '';
    const value = node.value?.toLowerCase() ?? '';

    // Check for dialog/alert UI patterns
    if (
      type.includes('dialog') ||
      type.includes('alert') ||
      type.includes('popup') ||
      label.includes('dialog') ||
      label.includes('alert') ||
      type.includes('modal') ||
      type.includes('sheet')
    ) {
      alertCandidates.push(node);
    }

    // Check for system-specific dialog content patterns
    if (
      label.includes('暂无可用打开方式') ||
      value.includes('暂无可用打开方式') ||
      label.includes('打开方式') ||
      value.includes('打开方式')
    ) {
      alertCandidates.push(node);
    }

    // Check for notification permission dialogs
    if (
      label.includes('通知') ||
      value.includes('通知') ||
      label.includes('权限') ||
      value.includes('权限')
    ) {
      alertCandidates.push(node);
    }

    // Check for privacy policy dialogs
    if (
      label.includes('隐私') ||
      value.includes('隐私') ||
      label.includes('政策') ||
      value.includes('政策') ||
      label.includes('协议') ||
      value.includes('协议')
    ) {
      alertCandidates.push(node);
    }

    // Check for update dialogs
    if (
      label.includes('更新') ||
      value.includes('更新') ||
      label.includes('升级') ||
      value.includes('升级')
    ) {
      alertCandidates.push(node);
    }
  }

  if (alertCandidates.length === 0) return null;

  // Find buttons within alert candidates
  const buttons: HarmonyAlertButton[] = [];
  let title: string | undefined;
  let message: string | undefined;

  for (const candidate of alertCandidates) {
    // Look for text content as title/message
    if (candidate.label && !title) {
      title = candidate.label;
    }
    if (candidate.value && !message) {
      message = candidate.value;
    }

    // Look for button nodes
    if (candidate.hittable && candidate.rect) {
      const btnLabel = candidate.label ?? candidate.value ?? '';
      const btnLabelLower = btnLabel.toLowerCase();
      const isButton =
        // English patterns
        btnLabelLower.includes('ok') ||
        btnLabelLower.includes('cancel') ||
        btnLabelLower.includes('confirm') ||
        btnLabelLower.includes('dismiss') ||
        btnLabelLower.includes('yes') ||
        btnLabelLower.includes('no') ||
        btnLabelLower.includes('allow') ||
        btnLabelLower.includes('deny') ||
        btnLabelLower.includes('accept') ||
        btnLabelLower.includes('reject') ||
        btnLabelLower.includes('continue') ||
        btnLabelLower.includes('close') ||
        btnLabelLower.includes('got it') ||
        // Chinese patterns (common in HarmonyOS)
        btnLabel.includes('确定') ||
        btnLabel.includes('确认') ||
        btnLabel.includes('取消') ||
        btnLabel.includes('是') ||
        btnLabel.includes('否') ||
        btnLabel.includes('允许') ||
        btnLabel.includes('不允许') ||
        btnLabel.includes('同意') ||
        btnLabel.includes('拒绝') ||
        btnLabel.includes('知道了') ||
        btnLabel.includes('同意并继续') ||
        btnLabel.includes('继续') ||
        btnLabel.includes('关闭') ||
        btnLabel.includes('稍后') ||
        btnLabel.includes('暂不') ||
        btnLabel.includes('下次再说') ||
        btnLabel.includes('跳过') ||
        candidate.type?.toLowerCase().includes('button');

      if (isButton) {
        const centerX = (candidate.rect.x ?? 0) + (candidate.rect.width ?? 0) / 2;
        const centerY = (candidate.rect.y ?? 0) + (candidate.rect.height ?? 0) / 2;
        buttons.push({
          label: btnLabel,
          x: centerX,
          y: centerY,
        });
      }
    }
  }

  if (buttons.length === 0) return null;

  return {
    alert: {
      visible: true,
      title,
      message,
      buttons,
    },
    nodes: alertCandidates,
  };
}

function chooseHarmonyAlertButton(
  buttons: HarmonyAlertButton[],
  action: 'accept' | 'dismiss',
): HarmonyAlertButton | null {
  if (buttons.length === 0) return null;

  const acceptPatterns = [
    // English
    'ok',
    'confirm',
    'yes',
    'accept',
    'allow',
    'continue',
    'got it',
    'close',
    'agree',
    // Chinese
    '确定',
    '确认',
    '是',
    '允许',
    '同意',
    '同意并继续',
    '继续',
    '知道了',
    '关闭',
    '跳过',
  ];
  const dismissPatterns = [
    // English
    'cancel',
    'dismiss',
    'no',
    'reject',
    'deny',
    'later',
    'skip',
    'not now',
    // Chinese
    '取消',
    '否',
    '不允许',
    '拒绝',
    '暂不',
    '稍后',
    '下次再说',
    '跳过',
  ];

  const patterns = action === 'accept' ? acceptPatterns : dismissPatterns;

  // First pass: exact match (preferred)
  for (const button of buttons) {
    const label = button.label.toLowerCase();
    for (const pattern of patterns) {
      if (label === pattern || label.includes(pattern)) {
        return button;
      }
    }
  }

  // Fallback: first button for accept, last for dismiss
  if (action === 'accept') {
    return buttons[0] ?? null;
  }
  return buttons[buttons.length - 1] ?? null;
}

function buildHarmonyAlertStatusResponse(alert: HarmonyAlertInfo | null): HarmonyAlertResult {
  return {
    kind: 'alertStatus',
    platform: 'harmonyos',
    action: 'get',
    alert,
    ...(alert ? successText('Alert visible') : successText('No alert visible')),
  };
}

function buildHarmonyAlertHandledResponse(
  action: 'accept' | 'dismiss',
  alert: HarmonyAlertInfo,
  button: string,
): HarmonyAlertResult {
  return {
    kind: 'alertHandled',
    platform: 'harmonyos',
    action,
    handled: true,
    alert,
    button,
    ...successText(`Alert ${action}ed`),
  };
}

/**
 * Auto-dismiss common HarmonyOS system dialogs that appear during app launch.
 * This handles:
 * - "暂无可用打开方式" (No available opening method)
 * - Notification permission dialogs
 * - Privacy policy dialogs
 * - Update prompts
 *
 * @param device Device info
 * @param maxAttempts Maximum number of attempts to dismiss dialogs
 * @returns Number of dialogs dismissed
 */
export async function dismissHarmonySystemDialogs(
  device: DeviceInfo,
  maxAttempts: number = 3,
): Promise<number> {
  let dismissedCount = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = await readHarmonyAlertCandidate(device);
    if (!candidate) {
      // No dialog visible
      break;
    }

    const { alert } = candidate;
    const title = (alert.title ?? '').toLowerCase();
    const message = (alert.message ?? '').toLowerCase();

    // Check for known system dialog patterns
    const isSystemDialog =
      title.includes('暂无可用打开方式') ||
      message.includes('暂无可用打开方式') ||
      title.includes('打开方式') ||
      message.includes('打开方式') ||
      title.includes('通知') ||
      message.includes('通知') ||
      title.includes('权限') ||
      message.includes('权限') ||
      title.includes('隐私') ||
      message.includes('隐私') ||
      title.includes('更新') ||
      message.includes('更新');

    if (!isSystemDialog) {
      // Not a system dialog, stop
      break;
    }

    // Try to dismiss by accepting (most system dialogs have "确定" or "知道了")
    const button = chooseHarmonyAlertButton(alert.buttons, 'accept');
    if (button) {
      await pressHarmony(device, button.x, button.y);
      dismissedCount++;
      // Small delay to let dialog dismiss
      await new Promise((resolve) => setTimeout(resolve, 500));
    } else {
      // No button found, try back
      await pressBackHarmony(device);
      dismissedCount++;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return dismissedCount;
}
