export function isDeepLinkTarget(input: string): boolean {
  const value = input.trim();
  if (!value) return false;
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\/.+/.test(value);
}
