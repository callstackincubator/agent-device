export type AndroidForegroundApp = { package?: string; activity?: string };
export type AndroidBlockingDialogFocus = {
  package?: string;
  focusedWindow: string;
  raw: string;
};

const ANDROID_FOCUS_MARKERS = [
  'mCurrentFocus=Window{',
  'mFocusedApp=AppWindowToken{',
  'mResumedActivity:',
  'ResumedActivity:',
] as const;
const ANDROID_ANR_TITLE_PATTERN = /\bApplication Not Responding:\s*([A-Za-z0-9_.]+)/i;
const ANDROID_RESPONDING_TITLE_PATTERN = /([^{}]*\bis(?:n't| not)\s+responding[^{}]*)/i;
const ANDROID_PACKAGE_PATTERN = /\b([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)\b/;

export function parseAndroidLaunchablePackages(stdout: string): string[] {
  const packages = new Set<string>();
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const firstToken = trimmed.split(/\s+/)[0] ?? '';
    if (!firstToken.includes('/')) continue;
    const pkg = firstToken.split('/')[0] ?? '';
    if (!pkg.includes('.')) continue;
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
  return parseAndroidFocusSegment(text, (segment) => parseAndroidComponentFromSegment(segment));
}

export function parseAndroidBlockingDialogFocus(text: string): AndroidBlockingDialogFocus | null {
  return parseAndroidFocusSegment(text, (segment, raw) =>
    parseAndroidBlockingDialogFromSegment(segment, raw),
  );
}

function parseAndroidFocusSegment<T>(
  text: string,
  parse: (segment: string, raw: string) => T | null,
): T | null {
  const lines = text.split('\n');

  for (const marker of ANDROID_FOCUS_MARKERS) {
    for (const line of lines) {
      const markerIndex = line.indexOf(marker);
      if (markerIndex === -1) continue;
      const raw = line.trim();
      const segment = line.slice(markerIndex + marker.length);
      const parsed = parse(segment, raw);
      if (parsed) return parsed;
    }
  }
  return null;
}

function parseAndroidBlockingDialogFromSegment(
  segment: string,
  raw: string,
): AndroidBlockingDialogFocus | null {
  const windowText = segment.split('}')[0]?.trim() ?? segment.trim();
  const anrMatch = ANDROID_ANR_TITLE_PATTERN.exec(windowText);
  if (anrMatch) {
    const packageName = anrMatch[1];
    return {
      package: packageName,
      focusedWindow: `Application Not Responding: ${packageName}`,
      raw,
    };
  }

  const respondingMatch = ANDROID_RESPONDING_TITLE_PATTERN.exec(windowText);
  if (!respondingMatch) return null;

  const focusedWindowTitle = respondingMatch[1];
  if (focusedWindowTitle === undefined) return null;
  const focusedWindow = focusedWindowTitle.trim().replace(/\s+/g, ' ');
  const packageName = ANDROID_PACKAGE_PATTERN.exec(focusedWindow)?.[1];
  return {
    ...(packageName ? { package: packageName } : {}),
    focusedWindow,
    raw,
  };
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
