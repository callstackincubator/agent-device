import { promises as fs } from 'node:fs';
import { runCmd } from '../../utils/exec.ts';

type XmlParserInstance = {
  parse(xml: string): unknown;
};

type XmlNode = {
  name: string;
  text: string | null;
  children: XmlNode[];
};

let xmlParserPromise: Promise<XmlParserInstance> | null = null;

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
  const dictEntries = await parseXmlPlistEntries(plist);
  for (let index = 0; index < dictEntries.length - 1; index += 1) {
    const entry = dictEntries[index];
    const nextEntry = dictEntries[index + 1];
    if (entry?.name === 'key' && entry.text === key && nextEntry?.name === 'string') {
      return nextEntry.text;
    }
  }
  return undefined;
}

async function parseXmlPlistEntries(plist: string): Promise<Array<{ name: string; text: string }>> {
  const document = await parseXmlDocument(plist);
  const plistNode = document.find((node) => node.name === 'plist');
  const dictNode = plistNode?.children.find((node) => node.name === 'dict');
  if (!dictNode) {
    return [];
  }
  return dictNode.children
    .map((child) => {
      const text = readXmlNodeText(child);
      return text ? { name: child.name, text } : null;
    })
    .filter((entry): entry is { name: string; text: string } => entry !== null);
}

async function parseXmlDocument(xml: string): Promise<XmlNode[]> {
  const parser = await loadXmlParser();
  return normalizeXmlNodes(parser.parse(xml));
}

async function loadXmlParser(): Promise<XmlParserInstance> {
  xmlParserPromise ??= import('fast-xml-parser').then(
    ({ XMLParser }) =>
      new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '',
        preserveOrder: true,
        trimValues: true,
        parseTagValue: false,
      }),
  );
  return await xmlParserPromise;
}

function normalizeXmlNodes(value: unknown): XmlNode[] {
  if (!Array.isArray(value)) return [];
  const nodes: XmlNode[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    for (const [name, childValue] of Object.entries(record)) {
      if (name === ':@' || name === '#text') continue;
      nodes.push({
        name,
        text: normalizeXmlNodeText(childValue) ?? normalizeXmlText(record['#text']),
        children: normalizeXmlNodes(childValue),
      });
    }
  }
  return nodes;
}

function normalizeXmlText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeXmlNodeText(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const text = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      return '#text' in entry
        ? normalizeXmlText((entry as Record<string, unknown>)['#text'])
        : null;
    })
    .filter((entry): entry is string => entry !== null)
    .join('')
    .trim();
  return text.length > 0 ? text : null;
}

function readXmlNodeText(node: XmlNode | undefined): string | null {
  return node?.text ?? null;
}
