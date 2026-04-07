import { promises as fs } from 'node:fs';
import { runCmd } from '../../utils/exec.ts';
import { parseXmlDocument } from './xml.ts';

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
    return await readXmlPlistString(plist, key);
  } catch {
    return undefined;
  }
}

async function readXmlPlistString(plist: string, key: string): Promise<string | undefined> {
  const document = await parseXmlDocument(plist);
  const plistNode = document.find((node) => node.name === 'plist');
  const dictNode = plistNode?.children.find((node) => node.name === 'dict');
  if (!dictNode) {
    return undefined;
  }
  for (let index = 0; index < dictNode.children.length - 1; index += 1) {
    const entry = dictNode.children[index];
    const nextEntry = dictNode.children[index + 1];
    if (entry?.name === 'key' && entry.text === key && nextEntry?.name === 'string') {
      return nextEntry.text ?? undefined;
    }
  }
  return undefined;
}
