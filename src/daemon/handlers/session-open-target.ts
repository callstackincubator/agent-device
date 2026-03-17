import { isDeepLinkTarget, resolveIosDeviceDeepLinkBundleId } from '../../core/open-target.ts';
import type { DeviceInfo } from '../../utils/device.ts';

async function resolveIosBundleIdForOpen(
  device: DeviceInfo,
  openTarget: string | undefined,
  currentAppBundleId?: string,
): Promise<string | undefined> {
  if (device.platform !== 'ios' || !openTarget) return undefined;
  if (isDeepLinkTarget(openTarget)) {
    if (device.kind === 'device') {
      return resolveIosDeviceDeepLinkBundleId(currentAppBundleId, openTarget);
    }
    return undefined;
  }
  return await tryResolveIosAppBundleId(device, openTarget);
}

async function tryResolveIosAppBundleId(device: DeviceInfo, openTarget: string): Promise<string | undefined> {
  try {
    const { resolveIosApp } = await import('../../platforms/ios/index.ts');
    return await resolveIosApp(device, openTarget);
  } catch {
    return undefined;
  }
}

export async function resolveAndroidPackageForOpen(
  device: DeviceInfo,
  openTarget: string | undefined,
): Promise<string | undefined> {
  if (device.platform !== 'android' || !openTarget || isDeepLinkTarget(openTarget)) return undefined;
  try {
    const { resolveAndroidApp } = await import('../../platforms/android/index.ts');
    const resolved = await resolveAndroidApp(device, openTarget);
    return resolved.type === 'package' ? resolved.value : undefined;
  } catch {
    return undefined;
  }
}

function shouldPreserveAndroidPackageContext(
  device: DeviceInfo,
  openTarget: string | undefined,
): boolean {
  return device.platform === 'android' && Boolean(openTarget && isDeepLinkTarget(openTarget));
}

export async function resolveSessionAppBundleIdForTarget(
  device: DeviceInfo,
  openTarget: string | undefined,
  currentAppBundleId: string | undefined,
  resolveAndroidPackageForOpenFn: (
    device: DeviceInfo,
    openTarget: string | undefined,
  ) => Promise<string | undefined>,
): Promise<string | undefined> {
  return (
    (await resolveIosBundleIdForOpen(device, openTarget, currentAppBundleId))
    ?? (await resolveAndroidPackageForOpenFn(device, openTarget))
    ?? (shouldPreserveAndroidPackageContext(device, openTarget) ? currentAppBundleId : undefined)
  );
}
