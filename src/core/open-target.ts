export function isDeepLinkTarget(input: string): boolean {
  const value = input.trim();
  if (!value) return false;
  if (/\s/.test(value)) return false;
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):(.+)$/.exec(value);
  if (!match) return false;
  const scheme = match[1]?.toLowerCase();
  const rest = match[2] ?? '';
  if (scheme === 'http' || scheme === 'https' || scheme === 'ws' || scheme === 'wss' || scheme === 'ftp' || scheme === 'ftps') {
    return rest.startsWith('//');
  }
  return true;
}
