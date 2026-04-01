import type {
  AgentDeviceDevice,
  AgentDeviceIdentifiers,
  AgentDeviceSession,
  AgentDeviceSessionDevice,
  AppCloseResult,
  AppDeployResult,
  AppInstallFromSourceResult,
  AppOpenResult,
  CaptureSnapshotResult,
  EnsureSimulatorResult,
  SessionCloseResult,
} from './client-types.ts';
import type { Platform } from './utils/device.ts';
import { successText, withSuccessText } from './utils/success-text.ts';

export function buildAppIdentifiers(params: {
  session?: string;
  bundleId?: string;
  packageName?: string;
  appId?: string;
}): AgentDeviceIdentifiers {
  const appId = params.appId ?? params.bundleId ?? params.packageName;
  return {
    session: params.session,
    appId,
    appBundleId: params.bundleId,
    package: params.packageName,
  };
}

export function buildDeviceIdentifiers(
  platform: Platform,
  id: string,
  name: string,
): AgentDeviceIdentifiers {
  return {
    deviceId: id,
    deviceName: name,
    ...(platform === 'android' ? { serial: id } : platform === 'ios' ? { udid: id } : {}),
  };
}

export function serializeSessionDevice(
  device: AgentDeviceSessionDevice,
  options: { includeAndroidSerial?: boolean } = {},
): Record<string, unknown> {
  const includeAndroidSerial = options.includeAndroidSerial ?? true;
  return {
    platform: device.platform,
    target: device.target,
    device: device.name,
    id: device.id,
    ...(device.platform === 'ios'
      ? {
          device_udid: device.ios?.udid ?? device.id,
          ios_simulator_device_set: device.ios?.simulatorSetPath ?? null,
        }
      : {}),
    ...(device.platform === 'android' && includeAndroidSerial
      ? {
          serial: device.android?.serial ?? device.id,
        }
      : {}),
  };
}

export function serializeSessionListEntry(session: AgentDeviceSession): Record<string, unknown> {
  return {
    name: session.name,
    ...serializeSessionDevice(session.device, { includeAndroidSerial: false }),
    createdAt: session.createdAt,
  };
}

export function serializeDevice(device: AgentDeviceDevice): Record<string, unknown> {
  return {
    platform: device.platform,
    id: device.id,
    name: device.name,
    kind: device.kind,
    target: device.target,
    ...(typeof device.booted === 'boolean' ? { booted: device.booted } : {}),
  };
}

export function serializeEnsureSimulatorResult(
  result: EnsureSimulatorResult,
): Record<string, unknown> {
  const action = result.created ? 'Created' : 'Reused';
  const bootedSuffix = result.booted ? ' (booted)' : '';
  return withSuccessText(
    {
      udid: result.udid,
      device: result.device,
      runtime: result.runtime,
      ios_simulator_device_set: result.iosSimulatorDeviceSet ?? null,
      created: result.created,
      booted: result.booted,
    },
    `${action}: ${result.device} ${result.udid}${bootedSuffix}`,
  );
}

export function resolveDeployResultTarget(result: {
  app: string;
  bundleId?: string;
  package?: string;
}): string {
  return result.bundleId ?? result.package ?? result.app;
}

export function serializeDeployResult(result: AppDeployResult): Record<string, unknown> {
  return withSuccessText(
    {
      app: result.app,
      appPath: result.appPath,
      platform: result.platform,
      ...(result.appId ? { appId: result.appId } : {}),
      ...(result.bundleId ? { bundleId: result.bundleId } : {}),
      ...(result.package ? { package: result.package } : {}),
    },
    `Installed: ${resolveDeployResultTarget(result)}`,
  );
}

export function resolveInstallFromSourceResultTarget(result: {
  appName?: string;
  bundleId?: string;
  packageName?: string;
  launchTarget: string;
}): string {
  return result.appName ?? result.bundleId ?? result.packageName ?? result.launchTarget;
}

export function serializeInstallFromSourceResult(
  result: AppInstallFromSourceResult,
): Record<string, unknown> {
  return withSuccessText(
    {
      launchTarget: result.launchTarget,
      ...(result.appName ? { appName: result.appName } : {}),
      ...(result.appId ? { appId: result.appId } : {}),
      ...(result.bundleId ? { bundleId: result.bundleId } : {}),
      ...(result.packageName ? { package: result.packageName } : {}),
      ...(result.installablePath ? { installablePath: result.installablePath } : {}),
      ...(result.archivePath ? { archivePath: result.archivePath } : {}),
      ...(result.materializationId ? { materializationId: result.materializationId } : {}),
      ...(result.materializationExpiresAt
        ? { materializationExpiresAt: result.materializationExpiresAt }
        : {}),
    },
    `Installed: ${resolveInstallFromSourceResultTarget(result)}`,
  );
}

export function serializeOpenResult(result: AppOpenResult): Record<string, unknown> {
  const target = result.appName ?? result.appBundleId ?? result.session;
  return withSuccessText(
    {
      session: result.session,
      ...(result.appName ? { appName: result.appName } : {}),
      ...(result.appBundleId ? { appBundleId: result.appBundleId } : {}),
      ...(result.startup ? { startup: result.startup } : {}),
      ...(result.runtime ? { runtime: result.runtime } : {}),
      ...(result.device ? serializeSessionDevice(result.device) : {}),
    },
    target ? `Opened: ${target}` : 'Opened',
  );
}

export function serializeCloseResult(
  result: SessionCloseResult | AppCloseResult,
): Record<string, unknown> {
  return {
    session: result.session,
    ...(result.shutdown ? { shutdown: result.shutdown } : {}),
    ...successText(result.session ? `Closed: ${result.session}` : 'Closed'),
  };
}

export function serializeSnapshotResult(result: CaptureSnapshotResult): Record<string, unknown> {
  return {
    nodes: result.nodes,
    truncated: result.truncated,
    ...(result.appName ? { appName: result.appName } : {}),
    ...(result.appBundleId ? { appBundleId: result.appBundleId } : {}),
    ...(result.warnings && result.warnings.length > 0 ? { warnings: result.warnings } : {}),
  };
}
