import type {
  AgentDeviceDevice,
  AgentDeviceIdentifiers,
  AgentDeviceSession,
  AgentDeviceSessionDevice,
  AppCloseResult,
  AppDeployResult,
  AppOpenResult,
  CaptureSnapshotResult,
  EnsureSimulatorResult,
  RuntimeResult,
  SessionCloseResult,
} from './client-types.ts';
import type { Platform } from './utils/device.ts';

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

export function buildDeviceIdentifiers(platform: Platform, id: string, name: string): AgentDeviceIdentifiers {
  return {
    deviceId: id,
    deviceName: name,
    ...(platform === 'ios' ? { udid: id } : { serial: id }),
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

export function serializeEnsureSimulatorResult(result: EnsureSimulatorResult): Record<string, unknown> {
  return {
    udid: result.udid,
    device: result.device,
    runtime: result.runtime,
    ios_simulator_device_set: result.iosSimulatorDeviceSet ?? null,
    created: result.created,
    booted: result.booted,
  };
}

export function serializeRuntimeResult(result: RuntimeResult): Record<string, unknown> {
  return {
    session: result.session,
    configured: result.configured,
    ...(result.cleared ? { cleared: true } : {}),
    ...(result.runtime ? { runtime: result.runtime } : {}),
  };
}

export function serializeDeployResult(result: AppDeployResult): Record<string, unknown> {
  return {
    app: result.app,
    appPath: result.appPath,
    platform: result.platform,
    ...(result.appId ? { appId: result.appId } : {}),
    ...(result.bundleId ? { bundleId: result.bundleId } : {}),
    ...(result.package ? { package: result.package } : {}),
  };
}

export function serializeOpenResult(result: AppOpenResult): Record<string, unknown> {
  return {
    session: result.session,
    ...(result.appName ? { appName: result.appName } : {}),
    ...(result.appBundleId ? { appBundleId: result.appBundleId } : {}),
    ...(result.startup ? { startup: result.startup } : {}),
    ...(result.runtime ? { runtime: result.runtime } : {}),
    ...(result.device ? serializeSessionDevice(result.device) : {}),
  };
}

export function serializeCloseResult(result: SessionCloseResult | AppCloseResult): Record<string, unknown> {
  return {
    session: result.session,
    ...(result.shutdown ? { shutdown: result.shutdown } : {}),
  };
}

export function serializeSnapshotResult(result: CaptureSnapshotResult): Record<string, unknown> {
  return {
    nodes: result.nodes,
    truncated: result.truncated,
    ...(result.appName ? { appName: result.appName } : {}),
    ...(result.appBundleId ? { appBundleId: result.appBundleId } : {}),
  };
}
