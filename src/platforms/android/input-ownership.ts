export type AndroidInputOwner = 'app' | 'ime' | 'unknown';

const FALLBACK_INPUT_METHOD_PACKAGES = new Set([
  'com.google.android.inputmethod.latin',
  'com.samsung.android.honeyboard',
  'com.touchtype.swiftkey',
  'com.microsoft.swiftkey',
]);

export function isAndroidInputMethodOwned(
  packageName: string | null | undefined,
  resourceId?: string | null,
  activeInputMethodPackage?: string | null,
): boolean {
  const normalizedPackageName = (packageName ?? '').toLowerCase();
  const normalizedResourceId = (resourceId ?? '').toLowerCase();
  const normalizedInputMethodPackage = (activeInputMethodPackage ?? '').toLowerCase();

  if (normalizedInputMethodPackage) {
    if (normalizedPackageName === normalizedInputMethodPackage) return true;
    return normalizedResourceId.startsWith(`${normalizedInputMethodPackage}:id/`);
  }

  if (isFallbackAndroidInputMethodPackage(normalizedPackageName)) return true;
  if (isFallbackAndroidInputMethodResource(normalizedResourceId)) return true;
  return false;
}

export function isFallbackAndroidInputMethodPackage(
  packageName: string | null | undefined,
): boolean {
  return FALLBACK_INPUT_METHOD_PACKAGES.has((packageName ?? '').toLowerCase());
}

export function isFallbackAndroidInputMethodResource(
  resourceId: string | null | undefined,
): boolean {
  const normalizedResourceId = (resourceId ?? '').toLowerCase();
  for (const packageName of FALLBACK_INPUT_METHOD_PACKAGES) {
    if (normalizedResourceId.startsWith(`${packageName}:id/`)) return true;
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
