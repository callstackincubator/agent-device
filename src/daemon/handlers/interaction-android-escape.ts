import { getAndroidAppState } from '../../platforms/android/index.ts';
import { AppError } from '../../utils/errors.ts';
import type { SessionState } from '../types.ts';

export async function assertAndroidPressStayedInApp(
  session: SessionState,
  targetLabel: string,
): Promise<void> {
  if (session.device.platform !== 'android' || !session.appBundleId) return;

  const foreground = await getAndroidAppState(session.device);
  const foregroundPackage = foreground.package?.trim();
  if (!foregroundPackage || foregroundPackage === session.appBundleId) return;
  if (!looksLikeAndroidEscapeSurface(foregroundPackage)) return;

  throw new AppError(
    'COMMAND_FAILED',
    `press ${targetLabel} left ${session.appBundleId} and foregrounded ${foregroundPackage}. The tap likely escaped the app.`,
    {
      expectedPackage: session.appBundleId,
      foregroundPackage,
      activity: foreground.activity,
      hint: 'Use screenshot as visual truth, then take a fresh snapshot -i before retrying.',
    },
  );
}

export function isAndroidEscapeError(error: AppError): boolean {
  return (
    error.code === 'COMMAND_FAILED' &&
    typeof error.details?.expectedPackage === 'string' &&
    typeof error.details?.foregroundPackage === 'string'
  );
}

function looksLikeAndroidEscapeSurface(packageName: string): boolean {
  return (
    packageName === 'com.android.settings' ||
    packageName === 'com.android.systemui' ||
    packageName === 'com.google.android.permissioncontroller' ||
    packageName.includes('launcher')
  );
}
