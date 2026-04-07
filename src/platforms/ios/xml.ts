export type XmlNode = {
  name: string;
  attributes: Record<string, string>;
  text: string | null;
  children: XmlNode[];
};

let xmlParserPromise: Promise<import('fast-xml-parser').XMLParser> | null = null;

export async function parseXmlDocument(xml: string): Promise<XmlNode[]> {
  const parser = await loadXmlParser();
  return normalizeXmlNodes(parser.parse(xml));
}

async function loadXmlParser(): Promise<import('fast-xml-parser').XMLParser> {
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
        attributes: normalizeXmlAttributes(record[':@']),
        text: readXmlText(childValue) ?? readXmlText(record['#text']),
        children: normalizeXmlNodes(childValue),
      });
    }
  }
  return nodes;
}

function normalizeXmlAttributes(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const attributes: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      attributes[key] = entry;
    }
  }
  return attributes;
}

function readXmlText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (!Array.isArray(value)) return null;
  const text = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const textValue = (entry as Record<string, unknown>)['#text'];
      return typeof textValue === 'string' ? textValue.trim() : null;
    })
    .filter((entry): entry is string => entry !== null && entry.length > 0)
    .join('')
    .trim();
  return text.length > 0 ? text : null;
}
