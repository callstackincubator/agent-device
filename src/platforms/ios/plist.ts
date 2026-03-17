import { promises as fs } from 'node:fs';
import { runCmd } from '../../utils/exec.ts';

export async function readInfoPlistString(
  infoPlistPath: string,
  key: string,
): Promise<string | undefined> {
  try {
    const result = await runCmd('plutil', ['-extract', key, 'raw', '-o', '-', infoPlistPath], {
      allowFailure: true,
    });
    if (result.exitCode === 0) {
      const value = String(result.stdout ?? '').trim();
      if (value.length > 0) {
        return value;
      }
    }
  } catch {
    // Fall through to XML parsing for non-Darwin environments without plutil.
  }

  try {
    const plist = await fs.readFile(infoPlistPath, 'utf8');
    return readXmlPlistString(plist, key);
  } catch {
    return undefined;
  }
}

function readXmlPlistString(plist: string, key: string): string | undefined {
  const escapedKey = escapeRegExp(key);
  const match = plist.match(
    new RegExp(`<key>\\s*${escapedKey}\\s*<\\/key>\\s*<string>([\\s\\S]*?)<\\/string>`, 'i'),
  );
  if (!match?.[1]) {
    return undefined;
  }
  const value = decodeXmlEntities(match[1].trim());
  return value.length > 0 ? value : undefined;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
