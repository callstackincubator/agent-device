export type AndroidForegroundApp = { package?: string; activity?: string };

export function parseAndroidLaunchablePackages(stdout: string): string[] {
  const packages = new Set<string>();
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const firstToken = trimmed.split(/\s+/)[0];
    const pkg = firstToken.includes('/') ? firstToken.split('/')[0] : firstToken;
    if (pkg) packages.add(pkg);
  }
  return Array.from(packages);
}

export function parseAndroidUserInstalledPackages(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line: string) => {
      const trimmed = line.trim();
      return trimmed.startsWith('package:') ? trimmed.slice('package:'.length) : trimmed;
    })
    .filter(Boolean);
}

export function parseAndroidForegroundApp(text: string): AndroidForegroundApp | null {
  const markers = [
    'mCurrentFocus=Window{',
    'mFocusedApp=AppWindowToken{',
    'mResumedActivity:',
    'ResumedActivity:',
  ];
  const lines = text.split('\n');

  for (const marker of markers) {
    for (const line of lines) {
      const markerIndex = line.indexOf(marker);
      if (markerIndex === -1) continue;
      const segment = line.slice(markerIndex + marker.length);
      const parsed = parseAndroidComponentFromSegment(segment);
      if (parsed) return parsed;
    }
  }
  return null;
}

function parseAndroidComponentFromSegment(segment: string): AndroidForegroundApp | null {
  for (const token of segment.trim().split(/\s+/)) {
    const slashIndex = token.indexOf('/');
    if (slashIndex <= 0) continue;

    const packageName = readAndroidName(token.slice(0, slashIndex), false);
    const activity = readAndroidName(token.slice(slashIndex + 1), true);
    if (packageName && activity && packageName.length === slashIndex) {
      return { package: packageName, activity };
    }
  }
  return null;
}

function readAndroidName(value: string, allowDollar: boolean): string {
  let index = 0;
  while (index < value.length && isAndroidNameChar(value[index], allowDollar)) {
    index += 1;
  }
  return value.slice(0, index);
}

function isAndroidNameChar(char: string | undefined, allowDollar: boolean): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    char === '_' ||
    char === '.' ||
    (allowDollar && char === '$')
  );
}
