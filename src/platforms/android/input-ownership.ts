export type AndroidInputOwner = 'app' | 'ime' | 'unknown';

export function isAndroidInputMethodOwned(
  packageName: string | null | undefined,
  resourceId?: string | null,
  activeInputMethodPackage?: string | null,
): boolean {
  const normalizedPackageName = (packageName ?? '').toLowerCase();
  const normalizedResourceId = (resourceId ?? '').toLowerCase();
  const normalizedInputMethodPackage = (activeInputMethodPackage ?? '').toLowerCase();
  if (normalizedInputMethodPackage && normalizedPackageName === normalizedInputMethodPackage) {
    return true;
  }
  if (normalizedPackageName.includes('inputmethod')) return true;
  if (normalizedPackageName === 'com.google.android.inputmethod.latin') return true;
  if (normalizedPackageName === 'com.samsung.android.honeyboard') return true;
  if (normalizedPackageName === 'com.touchtype.swiftkey') return true;
  if (normalizedPackageName === 'com.microsoft.swiftkey') return true;
  if (normalizedResourceId.startsWith('com.google.android.inputmethod.latin:id/')) return true;
  if (normalizedInputMethodPackage) {
    return normalizedResourceId.startsWith(`${normalizedInputMethodPackage}:id/`);
  }
  return false;
}

export function classifyAndroidInputOwner(
  packageName: string | null | undefined,
  resourceId?: string | null,
  activeInputMethodPackage?: string | null,
): AndroidInputOwner {
  if (!packageName && !resourceId) return 'unknown';
  return isAndroidInputMethodOwned(packageName, resourceId, activeInputMethodPackage)
    ? 'ime'
    : 'app';
}
