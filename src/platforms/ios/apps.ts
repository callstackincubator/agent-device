import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { runCmd } from '../../utils/exec.ts';
import { Deadline, retryWithPolicy } from '../../utils/retry.ts';
import { isDeepLinkTarget, resolveIosDeviceDeepLinkBundleId } from '../../core/open-target.ts';
import {
  parsePermissionAction,
  parsePermissionTarget,
  type PermissionSettingOptions,
} from '../permission-utils.ts';
import { parseAppearanceAction } from '../appearance.ts';

import { IOS_APP_LAUNCH_TIMEOUT_MS, IOS_DEVICECTL_TIMEOUT_MS } from './config.ts';
import {
  IOS_DEVICECTL_DEFAULT_HINT,
  listIosDeviceApps,
  resolveIosDevicectlHint,
  runIosDevicectl,
  type IosAppInfo,
} from './devicectl.ts';
import { runIosRunnerCommand, IOS_RUNNER_CONTAINER_BUNDLE_IDS } from './runner-client.ts';
import { ensureBootedSimulator, ensureSimulator, getSimulatorState } from './simulator.ts';

const ALIASES: Record<string, string> = {
  settings: 'com.apple.Preferences',
};
let cachedSimctlPrivacyServices: Set<string> | null = null;
let cachedSimctlPrivacyServicesPath: string | undefined;

function isMissingAppErrorOutput(output: string): boolean {
  return output.includes('not installed') || output.includes('not found') || output.includes('no such file');
}

export async function resolveIosApp(device: DeviceInfo, app: string): Promise<string> {
  const trimmed = app.trim();
  if (trimmed.includes('.')) return trimmed;

  const alias = ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;

  const list =
    device.kind === 'simulator'
      ? await listSimulatorApps(device)
      : await listIosDeviceApps(device, 'all');
  const matches = list.filter((entry) => entry.name.toLowerCase() === trimmed.toLowerCase());
  if (matches.length === 1) return matches[0].bundleId;
  if (matches.length > 1) {
    throw new AppError('INVALID_ARGS', `Multiple apps matched "${app}"`, { matches });
  }

  throw new AppError('APP_NOT_INSTALLED', `No app found matching "${app}"`);
}

export async function openIosApp(
  device: DeviceInfo,
  app: string,
  options?: { appBundleId?: string; url?: string },
): Promise<void> {
  const explicitUrl = options?.url?.trim();
  if (explicitUrl) {
    if (!isDeepLinkTarget(explicitUrl)) {
      throw new AppError('INVALID_ARGS', 'open <app> <url> requires a valid URL target');
    }
    if (device.kind === 'simulator') {
      await ensureBootedSimulator(device);
      await runCmd('open', ['-a', 'Simulator'], { allowFailure: true });
      await runCmd('xcrun', ['simctl', 'openurl', device.id, explicitUrl]);
      return;
    }
    const appBundleId = options?.appBundleId ?? (await resolveIosApp(device, app));
    const bundleId = resolveIosDeviceDeepLinkBundleId(appBundleId, explicitUrl);
    if (!bundleId) {
      throw new AppError(
        'INVALID_ARGS',
        'Deep link open on iOS devices requires an active app bundle ID. Open the app first, then open the URL.',
      );
    }
    await launchIosDeviceProcess(device, bundleId, { payloadUrl: explicitUrl });
    return;
  }

  const deepLinkTarget = app.trim();
  if (isDeepLinkTarget(deepLinkTarget)) {
    if (device.kind === 'simulator') {
      await ensureBootedSimulator(device);
      await runCmd('open', ['-a', 'Simulator'], { allowFailure: true });
      await runCmd('xcrun', ['simctl', 'openurl', device.id, deepLinkTarget]);
      return;
    }
    const bundleId = resolveIosDeviceDeepLinkBundleId(options?.appBundleId, deepLinkTarget);
    if (!bundleId) {
      throw new AppError(
        'INVALID_ARGS',
        'Deep link open on iOS devices requires an active app bundle ID. Open the app first, then open the URL.',
      );
    }
    await launchIosDeviceProcess(device, bundleId, { payloadUrl: deepLinkTarget });
    return;
  }

  const bundleId = options?.appBundleId ?? (await resolveIosApp(device, app));
  if (device.kind === 'simulator') {
    await launchIosSimulatorApp(device, bundleId);
    return;
  }

  await launchIosDeviceProcess(device, bundleId);
}

export async function openIosDevice(device: DeviceInfo): Promise<void> {
  if (device.kind !== 'simulator') return;
  const state = await getSimulatorState(device.id);
  if (state === 'Booted') return;

  await ensureBootedSimulator(device);
  await runCmd('open', ['-a', 'Simulator'], { allowFailure: true });
}

export async function closeIosApp(device: DeviceInfo, app: string): Promise<void> {
  const bundleId = await resolveIosApp(device, app);
  if (device.kind === 'simulator') {
    await ensureBootedSimulator(device);
    const result = await runCmd('xcrun', ['simctl', 'terminate', device.id, bundleId], {
      allowFailure: true,
    });
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toLowerCase();
      if (stderr.includes('found nothing to terminate')) return;
      throw new AppError('COMMAND_FAILED', `xcrun exited with code ${result.exitCode}`, {
        cmd: 'xcrun',
        args: ['simctl', 'terminate', device.id, bundleId],
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    }
    return;
  }

  await runIosDevicectl(['device', 'process', 'terminate', '--device', device.id, bundleId], {
    action: 'terminate iOS app',
    deviceId: device.id,
  });
}

export async function uninstallIosApp(device: DeviceInfo, app: string): Promise<{ bundleId: string }> {
  const bundleId = await resolveIosApp(device, app);
  if (device.kind !== 'simulator') {
    const args = ['devicectl', 'device', 'uninstall', 'app', '--device', device.id, bundleId];
    const result = await runCmd('xcrun', args, {
      allowFailure: true,
      timeoutMs: IOS_DEVICECTL_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) {
      const stdout = String(result.stdout ?? '');
      const stderr = String(result.stderr ?? '');
      const output = `${stdout}\n${stderr}`.toLowerCase();
      if (!isMissingAppErrorOutput(output)) {
        throw new AppError('COMMAND_FAILED', `Failed to uninstall iOS app ${bundleId}`, {
          cmd: 'xcrun',
          args,
          exitCode: result.exitCode,
          stdout,
          stderr,
          deviceId: device.id,
          hint: resolveIosDevicectlHint(stdout, stderr) ?? IOS_DEVICECTL_DEFAULT_HINT,
        });
      }
    }
    return { bundleId };
  }

  await ensureBootedSimulator(device);

  const result = await runCmd('xcrun', ['simctl', 'uninstall', device.id, bundleId], {
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
    if (!isMissingAppErrorOutput(output)) {
      throw new AppError('COMMAND_FAILED', `simctl uninstall failed for ${bundleId}`, {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    }
  }

  return { bundleId };
}

export async function installIosApp(device: DeviceInfo, appPath: string): Promise<void> {
  if (device.kind !== 'simulator') {
    await runIosDevicectl(['device', 'install', 'app', '--device', device.id, appPath], {
      action: 'install iOS app',
      deviceId: device.id,
    });
    return;
  }

  await ensureBootedSimulator(device);
  await runCmd('xcrun', ['simctl', 'install', device.id, appPath]);
}

export async function reinstallIosApp(
  device: DeviceInfo,
  app: string,
  appPath: string,
): Promise<{ bundleId: string }> {
  const { bundleId } = await uninstallIosApp(device, app);
  await installIosApp(device, appPath);
  return { bundleId };
}

export async function screenshotIos(device: DeviceInfo, outPath: string, appBundleId?: string): Promise<void> {
  if (device.kind === 'simulator') {
    await ensureBootedSimulator(device);
    await runCmd('xcrun', ['simctl', 'io', device.id, 'screenshot', outPath]);
    return;
  }

  try {
    await runIosDevicectl(['device', 'screenshot', '--device', device.id, outPath], {
      action: 'capture iOS screenshot',
      deviceId: device.id,
    });
    return;
  } catch (error) {
    if (!shouldFallbackToRunnerForIosScreenshot(error)) {
      throw error;
    }
  }

  // `xcrun devicectl device screenshot` is unavailable (removed in Xcode 26.x).
  // Fall back to the XCTest runner: capture to the device's temp directory,
  // then pull the file to the host via `devicectl device copy from`.
  const result = await runIosRunnerCommand(device, { command: 'screenshot', appBundleId });
  const remoteFileName = result['message'] as string;
  if (!remoteFileName) {
    throw new AppError('COMMAND_FAILED', 'Failed to capture iOS screenshot: runner returned no file path');
  }

  let copyResult = { exitCode: 1, stdout: '', stderr: '' };
  for (const bundleId of IOS_RUNNER_CONTAINER_BUNDLE_IDS) {
    copyResult = await runCmd(
      'xcrun',
      [
        'devicectl',
        'device',
        'copy',
        'from',
        '--device',
        device.id,
        '--source',
        remoteFileName,
        '--destination',
        outPath,
        '--domain-type',
        'appDataContainer',
        '--domain-identifier',
        bundleId,
      ],
      { allowFailure: true },
    );
    if (copyResult.exitCode === 0) {
      break;
    }
  }

  if (copyResult.exitCode !== 0) {
    const copyError = copyResult.stderr.trim() || copyResult.stdout.trim() || `devicectl exited with code ${copyResult.exitCode}`;
    throw new AppError('COMMAND_FAILED', `Failed to capture iOS screenshot: ${copyError}`);
  }
}

export function shouldFallbackToRunnerForIosScreenshot(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  if (error.code !== 'COMMAND_FAILED') return false;
  const details = (error.details ?? {}) as { stdout?: unknown; stderr?: unknown };
  const stdout = typeof details.stdout === 'string' ? details.stdout : '';
  const stderr = typeof details.stderr === 'string' ? details.stderr : '';
  const combined = `${error.message}\n${stdout}\n${stderr}`.toLowerCase();
  return (
    combined.includes("unknown option '--device'") ||
    (combined.includes('unknown subcommand') && combined.includes('screenshot')) ||
    (combined.includes('unrecognized subcommand') && combined.includes('screenshot'))
  );
}

export async function readIosClipboardText(device: DeviceInfo): Promise<string> {
  ensureSimulator(device, 'clipboard');
  await ensureBootedSimulator(device);
  const result = await runCmd('xcrun', ['simctl', 'pbpaste', device.id], { allowFailure: true });
  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', 'Failed to read iOS simulator clipboard', {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  }
  return result.stdout.replace(/\r\n/g, '\n').replace(/\n$/, '');
}

export async function writeIosClipboardText(device: DeviceInfo, text: string): Promise<void> {
  ensureSimulator(device, 'clipboard');
  await ensureBootedSimulator(device);
  const result = await runCmd('xcrun', ['simctl', 'pbcopy', device.id], {
    allowFailure: true,
    stdin: text,
  });
  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', 'Failed to write iOS simulator clipboard', {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  }
}

export async function pushIosNotification(
  device: DeviceInfo,
  bundleId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  ensureSimulator(device, 'push');
  await ensureBootedSimulator(device);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-push-'));
  const payloadPath = path.join(tempDir, 'payload.apns');
  try {
    await fs.writeFile(payloadPath, `${JSON.stringify(payload)}\n`, 'utf8');
    await runCmd('xcrun', ['simctl', 'push', device.id, bundleId, payloadPath]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function setIosSetting(
  device: DeviceInfo,
  setting: string,
  state: string,
  appBundleId?: string,
  options?: PermissionSettingOptions,
): Promise<void> {
  ensureSimulator(device, 'settings');
  await ensureBootedSimulator(device);
  const normalized = setting.toLowerCase();

  switch (normalized) {
    case 'wifi': {
      const enabled = parseSettingState(state);
      const mode = enabled ? 'active' : 'failed';
      await runCmd('xcrun', ['simctl', 'status_bar', device.id, 'override', '--wifiMode', mode]);
      return;
    }
    case 'airplane': {
      const enabled = parseSettingState(state);
      if (enabled) {
        await runCmd('xcrun', [
          'simctl',
          'status_bar',
          device.id,
          'override',
          '--dataNetwork',
          'hide',
          '--wifiMode',
          'failed',
          '--wifiBars',
          '0',
          '--cellularMode',
          'failed',
          '--cellularBars',
          '0',
          '--operatorName',
          '',
        ]);
      } else {
        await runCmd('xcrun', ['simctl', 'status_bar', device.id, 'clear']);
      }
      return;
    }
    case 'location': {
      const enabled = parseSettingState(state);
      if (!appBundleId) {
        throw new AppError('INVALID_ARGS', 'location setting requires an active app in session');
      }
      const action = enabled ? 'grant' : 'revoke';
      await runCmd('xcrun', ['simctl', 'privacy', device.id, action, 'location', appBundleId]);
      return;
    }
    case 'faceid':
    case 'touchid': {
      const biometricSetting = normalized as IosBiometricSetting;
      const biometric = IOS_BIOMETRIC_SETTINGS[biometricSetting];
      const action = parseBiometricAction(state, biometricSetting);
      await runIosBiometricSimctlCommand(device.id, action, {
        settingName: biometricSetting,
        label: biometric.label,
        modalityAliases: biometric.modalityAliases,
      });
      return;
    }
    case 'appearance': {
      const target = await resolveIosAppearanceTarget(device.id, state);
      await runCmd('xcrun', ['simctl', 'ui', device.id, 'appearance', target]);
      return;
    }
    case 'permission': {
      if (!appBundleId) {
        throw new AppError(
          'INVALID_ARGS',
          'permission setting requires an active app in session',
        );
      }
      const action = mapIosPermissionAction(parsePermissionAction(state));
      const target = parseIosPermissionTarget(options?.permissionTarget, options?.permissionMode);
      await runIosPrivacyCommand(device.id, action, target, appBundleId);
      return;
    }
    default:
      throw new AppError('INVALID_ARGS', `Unsupported setting: ${setting}`);
  }
}

export async function listIosApps(
  device: DeviceInfo,
  filter: 'user-installed' | 'all' = 'all',
): Promise<IosAppInfo[]> {
  if (device.kind === 'simulator') {
    const apps = await listSimulatorApps(device);
    return filterIosAppsByBundlePrefix(apps, filter);
  }
  return await listIosDeviceApps(device, filter);
}

export async function listSimulatorApps(device: DeviceInfo): Promise<IosAppInfo[]> {
  const result = await runCmd('xcrun', ['simctl', 'listapps', device.id], { allowFailure: true });
  const stdout = result.stdout as string;
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  let parsed: Record<string, { CFBundleDisplayName?: string; CFBundleName?: string }> | null = null;
  if (trimmed.startsWith('{')) {
    try {
      parsed = JSON.parse(trimmed) as Record<string, { CFBundleDisplayName?: string; CFBundleName?: string }>;
    } catch {
      parsed = null;
    }
  }

  if (!parsed && trimmed.startsWith('{')) {
    try {
      const converted = await runCmd('plutil', ['-convert', 'json', '-o', '-', '-'], {
        allowFailure: true,
        stdin: trimmed,
      });
      if (converted.exitCode === 0 && converted.stdout.trim().startsWith('{')) {
        parsed = JSON.parse(converted.stdout) as Record<
          string,
          { CFBundleDisplayName?: string; CFBundleName?: string }
        >;
      }
    } catch {
      parsed = null;
    }
  }

  if (!parsed) return [];
  return Object.entries(parsed).map(([bundleId, info]) => ({
    bundleId,
    name: info.CFBundleDisplayName ?? info.CFBundleName ?? bundleId,
  }));
}

function parseSettingState(state: string): boolean {
  const normalized = state.toLowerCase();
  if (normalized === 'on' || normalized === 'true' || normalized === '1') return true;
  if (normalized === 'off' || normalized === 'false' || normalized === '0') return false;
  throw new AppError('INVALID_ARGS', `Invalid setting state: ${state}`);
}

async function resolveIosAppearanceTarget(deviceId: string, state: string): Promise<'light' | 'dark'> {
  const action = parseAppearanceAction(state);
  if (action !== 'toggle') return action;

  const currentResult = await runCmd('xcrun', ['simctl', 'ui', deviceId, 'appearance'], {
    allowFailure: true,
  });
  if (currentResult.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', 'Failed to read current iOS appearance', {
      stdout: currentResult.stdout,
      stderr: currentResult.stderr,
      exitCode: currentResult.exitCode,
    });
  }
  const current = parseIosAppearance(currentResult.stdout, currentResult.stderr);
  if (!current) {
    throw new AppError('COMMAND_FAILED', 'Unable to determine current iOS appearance for toggle', {
      stdout: currentResult.stdout,
      stderr: currentResult.stderr,
    });
  }
  return current === 'dark' ? 'light' : 'dark';
}

function parseIosAppearance(stdout: string, stderr: string): 'light' | 'dark' | null {
  const match = /\b(light|dark|unsupported|unknown)\b/i.exec(`${stdout}\n${stderr}`);
  if (!match) return null;
  const value = match[1].toLowerCase();
  if (value === 'dark') return 'dark';
  if (value === 'light') return 'light';
  return null;
}

type IosBiometricAction = 'match' | 'nonmatch' | 'enroll' | 'unenroll';
type IosBiometricSetting = 'faceid' | 'touchid';

const IOS_BIOMETRIC_SETTINGS: Record<
  IosBiometricSetting,
  { label: 'Face ID' | 'Touch ID'; modalityAliases: string[] }
> = {
  faceid: { label: 'Face ID', modalityAliases: ['face'] },
  touchid: { label: 'Touch ID', modalityAliases: ['finger', 'touch'] },
};

function mapIosPermissionAction(action: 'grant' | 'deny' | 'reset'): 'grant' | 'revoke' | 'reset' {
  if (action === 'deny') return 'revoke';
  return action;
}

async function runIosPrivacyCommand(
  deviceId: string,
  action: 'grant' | 'revoke' | 'reset',
  target: string,
  appBundleId: string,
): Promise<void> {
  const supportedServices = await getSimctlPrivacyServices();
  if (!supportedServices.has(target)) {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      `iOS simctl privacy does not support service "${target}" on this runtime.`,
      {
        deviceId,
        appBundleId,
        hint: `Supported services: ${Array.from(supportedServices).sort().join(', ')}`,
      },
    );
  }

  const args = ['simctl', 'privacy', deviceId, action, target, appBundleId];
  const isNotificationsTarget = target === 'notifications';
  if (!(action === 'reset' && isNotificationsTarget)) {
    try {
      await runCmd('xcrun', args);
      return;
    } catch (error) {
      if (!(isNotificationsTarget && isNotificationsOperationNotPermitted(error))) {
        throw error;
      }
      throw new AppError(
        'UNSUPPORTED_OPERATION',
        'iOS simulator does not support setting notifications permission via simctl privacy on this runtime.',
        {
          deviceId,
          appBundleId,
          hint: 'Use reset notifications for reprompt behavior, or toggle notifications manually in Settings.',
        },
      );
    }
  }

  try {
    await runCmd('xcrun', args);
    return;
  } catch (error) {
    if (!isNotificationsOperationNotPermitted(error)) {
      throw error;
    }
  }

  try {
    await runCmd('xcrun', ['simctl', 'privacy', deviceId, 'reset', 'all', appBundleId]);
  } catch (error) {
    throw new AppError(
      'COMMAND_FAILED',
      'iOS simulator blocked direct notifications reset. Fallback reset-all also failed.',
      {
        deviceId,
        appBundleId,
        hint: 'Use reinstall to force a fresh notifications prompt, or reset simulator content and settings.',
      },
      error instanceof Error ? error : undefined,
    );
  }
}

function isNotificationsOperationNotPermitted(error: unknown): boolean {
  if (!(error instanceof AppError) || error.code !== 'COMMAND_FAILED') return false;
  const stderr = String(error.details?.stderr ?? '').toLowerCase();
  return (
    (stderr.includes('failed to grant access') ||
      stderr.includes('failed to revoke access') ||
      stderr.includes('failed to reset access')) &&
    stderr.includes('operation not permitted')
  );
}

async function getSimctlPrivacyServices(): Promise<Set<string>> {
  const currentPath = process.env.PATH;
  if (cachedSimctlPrivacyServices && cachedSimctlPrivacyServicesPath === currentPath) {
    return cachedSimctlPrivacyServices;
  }
  const result = await runCmd('xcrun', ['simctl', 'privacy', 'help'], { allowFailure: true });
  const services = parseSimctlPrivacyServices(`${result.stdout}\n${result.stderr}`);
  if (services.size === 0) {
    throw new AppError('COMMAND_FAILED', 'Unable to determine supported simctl privacy services', {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      hint: 'Run `xcrun simctl privacy help` manually to verify available services for this runtime.',
    });
  }
  cachedSimctlPrivacyServices = services;
  cachedSimctlPrivacyServicesPath = currentPath;
  return services;
}

function parseSimctlPrivacyServices(helpText: string): Set<string> {
  const services = new Set<string>();
  let inServiceSection = false;
  for (const line of helpText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === 'service') {
      inServiceSection = true;
      continue;
    }
    if (!inServiceSection) continue;
    if (trimmed.startsWith('bundle identifier')) break;
    const match = /^([a-z-]+)\s+-\s+/.exec(trimmed);
    if (match) {
      services.add(match[1]);
    }
  }
  return services;
}

function parseIosPermissionTarget(permissionTarget: string | undefined, permissionMode: string | undefined): string {
  const normalized = parsePermissionTarget(permissionTarget);
  if (normalized !== 'photos' && permissionMode?.trim()) {
    throw new AppError(
      'INVALID_ARGS',
      `Permission mode is only supported for photos. Received: ${permissionMode}.`,
    );
  }
  if (normalized === 'camera') return 'camera';
  if (normalized === 'microphone') return 'microphone';
  if (normalized === 'contacts') return 'contacts';
  if (normalized === 'contacts-limited') return 'contacts-limited';
  if (normalized === 'notifications') return 'notifications';
  if (normalized === 'calendar') return 'calendar';
  if (normalized === 'location') return 'location';
  if (normalized === 'location-always') return 'location-always';
  if (normalized === 'media-library') return 'media-library';
  if (normalized === 'motion') return 'motion';
  if (normalized === 'reminders') return 'reminders';
  if (normalized === 'siri') return 'siri';
  if (normalized === 'photos') {
    const mode = permissionMode?.trim().toLowerCase();
    if (!mode || mode === 'full') return 'photos';
    if (mode === 'limited') return 'photos-add';
    throw new AppError('INVALID_ARGS', `Invalid photos mode: ${permissionMode}. Use full|limited.`);
  }
  throw new AppError(
    'INVALID_ARGS',
    `Unsupported permission target: ${permissionTarget}. Use camera|microphone|photos|contacts|contacts-limited|notifications|calendar|location|location-always|media-library|motion|reminders|siri.`,
  );
}

function parseBiometricAction(
  state: string,
  settingName: IosBiometricSetting,
): IosBiometricAction {
  const normalized = state.trim().toLowerCase();
  if (normalized === 'match') return 'match';
  if (normalized === 'nonmatch') return 'nonmatch';
  if (normalized === 'enroll') return 'enroll';
  if (normalized === 'unenroll') return 'unenroll';
  throw new AppError(
    'INVALID_ARGS',
    `Invalid ${settingName} state: ${state}. Use match|nonmatch|enroll|unenroll.`,
  );
}

async function runIosBiometricSimctlCommand(
  deviceId: string,
  action: IosBiometricAction,
  options: { settingName: IosBiometricSetting; label: 'Face ID' | 'Touch ID'; modalityAliases: string[] },
): Promise<void> {
  const attempts = biometricCommandAttempts(deviceId, action, options.modalityAliases);
  const failures: Array<{ args: string[]; stderr: string; stdout: string; exitCode: number }> = [];

  for (const args of attempts) {
    const result = await runCmd('xcrun', args, { allowFailure: true });
    if (result.exitCode === 0) return;
    failures.push({
      args,
      stderr: result.stderr,
      stdout: result.stdout,
      exitCode: result.exitCode,
    });
  }

  const attemptsPayload = failures.map((failure) => ({
    args: failure.args.join(' '),
    exitCode: failure.exitCode,
    stderr: failure.stderr.slice(0, 400),
  }));
  const capabilityMissing = failures.length > 0 && failures.every((failure) =>
    isIosBiometricCapabilityMissing(failure.stdout, failure.stderr)
  );
  if (capabilityMissing) {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      `${options.label} simulation is not supported on this simulator runtime.`,
      {
        deviceId,
        action,
        setting: options.settingName,
        attempts: attemptsPayload,
      },
    );
  }
  throw new AppError('COMMAND_FAILED', `Failed to simulate ${options.settingName}.`, {
    deviceId,
    action,
    setting: options.settingName,
    attempts: attemptsPayload,
  });
}

function biometricCommandAttempts(
  deviceId: string,
  action: IosBiometricAction,
  modalityAliases: string[],
): string[][] {
  const modalities = modalityAliases.length > 0 ? modalityAliases : ['face'];
  switch (action) {
    case 'match':
      return modalities.flatMap((modality) => [
        ['simctl', 'biometric', deviceId, 'match', modality],
        ['simctl', 'biometric', 'match', deviceId, modality],
      ]);
    case 'nonmatch':
      return modalities.flatMap((modality) => [
        ['simctl', 'biometric', deviceId, 'nonmatch', modality],
        ['simctl', 'biometric', deviceId, 'nomatch', modality],
        ['simctl', 'biometric', 'nonmatch', deviceId, modality],
        ['simctl', 'biometric', 'nomatch', deviceId, modality],
      ]);
    case 'enroll':
      return [
        ['simctl', 'biometric', deviceId, 'enroll', 'yes'],
        ['simctl', 'biometric', deviceId, 'enroll', '1'],
        ['simctl', 'biometric', 'enroll', deviceId, 'yes'],
        ['simctl', 'biometric', 'enroll', deviceId, '1'],
      ];
    case 'unenroll':
      return [
        ['simctl', 'biometric', deviceId, 'enroll', 'no'],
        ['simctl', 'biometric', deviceId, 'enroll', '0'],
        ['simctl', 'biometric', 'enroll', deviceId, 'no'],
        ['simctl', 'biometric', 'enroll', deviceId, '0'],
      ];
  }
}

function isIosBiometricCapabilityMissing(stdout: string, stderr: string): boolean {
  const text = `${stdout}\n${stderr}`.toLowerCase();
  return (
    text.includes('unrecognized subcommand') ||
    text.includes('unknown subcommand') ||
    text.includes('not supported') ||
    text.includes('unavailable') ||
    (text.includes('biometric') && text.includes('invalid'))
  );
}

function isTransientSimulatorLaunchFailure(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  if (error.code !== 'COMMAND_FAILED') return false;

  const details = (error.details ?? {}) as { exitCode?: number; stderr?: unknown };
  if (details.exitCode !== 4) return false;
  const stderr = String(details.stderr ?? '').toLowerCase();

  return (
    stderr.includes('fbsopenapplicationserviceerrordomain') &&
    stderr.includes('the request to open')
  );
}

async function launchIosSimulatorApp(device: DeviceInfo, bundleId: string): Promise<void> {
  await ensureBootedSimulator(device);
  await runCmd('open', ['-a', 'Simulator'], { allowFailure: true });

  const launchDeadline = Deadline.fromTimeoutMs(IOS_APP_LAUNCH_TIMEOUT_MS);
  await retryWithPolicy(
    async ({ deadline: attemptDeadline }) => {
      if (attemptDeadline?.isExpired()) {
        throw new AppError('COMMAND_FAILED', 'App launch deadline exceeded', {
          timeoutMs: IOS_APP_LAUNCH_TIMEOUT_MS,
        });
      }

      const result = await runCmd('xcrun', ['simctl', 'launch', device.id, bundleId], {
        allowFailure: true,
      });
      if (result.exitCode === 0) return;

      throw new AppError('COMMAND_FAILED', `xcrun exited with code ${result.exitCode}`, {
        cmd: 'xcrun',
        args: ['simctl', 'launch', device.id, bundleId],
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    },
    {
      maxAttempts: 30,
      baseDelayMs: 1_000,
      maxDelayMs: 5_000,
      jitter: 0.2,
      shouldRetry: isTransientSimulatorLaunchFailure,
    },
    { deadline: launchDeadline },
  );
}

async function launchIosDeviceProcess(
  device: DeviceInfo,
  bundleId: string,
  options?: { payloadUrl?: string },
): Promise<void> {
  const args = ['device', 'process', 'launch', '--device', device.id, bundleId];
  if (options?.payloadUrl) {
    args.push('--payload-url', options.payloadUrl);
  }
  await runIosDevicectl(args, { action: 'launch iOS app', deviceId: device.id });
}

function filterIosAppsByBundlePrefix(apps: IosAppInfo[], filter: 'user-installed' | 'all'): IosAppInfo[] {
  if (filter === 'user-installed') {
    return apps.filter((app) => !app.bundleId.startsWith('com.apple.'));
  }
  return apps;
}
