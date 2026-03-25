type TextSurfaceNode = {
  type?: string;
  label?: string;
  value?: string;
  identifier?: string;
  role?: string;
  subrole?: string;
};

export function extractReadableText(node: TextSurfaceNode): string {
  const label = trimText(node.label);
  const value = trimText(node.value);
  const identifier = trimText(node.identifier);
  if (prefersValueForReadableText(node.type ?? '')) {
    return value || label || identifier;
  }
  return label || value || identifier;
}

export function isLargeTextSurface(node: TextSurfaceNode, displayType?: string): boolean {
  if (displayType === 'text-view' || displayType === 'text-field' || displayType === 'search') {
    return true;
  }
  const normalized = normalizeTextSurfaceType(node.type ?? '');
  const rawRole = `${node.role ?? ''} ${node.subrole ?? ''}`.toLowerCase();
  return (
    normalized.includes('textview') ||
    normalized.includes('textarea') ||
    normalized.includes('textfield') ||
    normalized.includes('securetextfield') ||
    normalized.includes('searchfield') ||
    normalized.includes('edittext') ||
    rawRole.includes('text area') ||
    rawRole.includes('text field')
  );
}

export function buildTextPreview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 48) {
    return normalized;
  }
  return `${normalized.slice(0, 45)}...`;
}

export function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function prefersValueForReadableText(type: string): boolean {
  const normalized = normalizeTextSurfaceType(type);
  return (
    normalized.includes('textfield') ||
    normalized.includes('securetextfield') ||
    normalized.includes('searchfield') ||
    normalized.includes('edittext') ||
    normalized.includes('textview') ||
    normalized.includes('textarea')
  );
}

function normalizeTextSurfaceType(type: string): string {
  let normalized = type
    .trim()
    .replace(/XCUIElementType/gi, '')
    .replace(/^AX/, '')
    .toLowerCase();
  const lastSeparator = Math.max(normalized.lastIndexOf('.'), normalized.lastIndexOf('/'));
  if (lastSeparator !== -1) {
    normalized = normalized.slice(lastSeparator + 1);
  }
  return normalized;
}
