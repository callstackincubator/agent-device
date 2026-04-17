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
  const fallbackIdentifier = isMeaningfulReadableIdentifier(identifier) ? identifier : '';
  if (prefersValueForReadableText(node.type ?? '')) {
    return value || label || fallbackIdentifier;
  }
  return label || value || fallbackIdentifier;
}

export function isLargeTextSurface(node: TextSurfaceNode, displayType?: string): boolean {
  if (displayType === 'text-view' || displayType === 'text-field' || displayType === 'search') {
    return true;
  }
  const normalized = normalizeType(node.type ?? '');
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

export function describeTextSurface(
  node: TextSurfaceNode,
  displayType?: string,
): {
  text: string;
  isLargeSurface: boolean;
  shouldSummarize: boolean;
} {
  const text = extractReadableText(node);
  const isLargeSurface = isLargeTextSurface(node, displayType);
  return {
    text,
    isLargeSurface,
    shouldSummarize: isLargeSurface && shouldSummarizeTextSurface(text),
  };
}

export function shouldSummarizeTextSurface(text: string): boolean {
  if (!text) {
    return false;
  }
  return text.length > 80 || /[\r\n]/.test(text);
}

export function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeType(type: string): string {
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

function prefersValueForReadableText(type: string): boolean {
  const normalized = normalizeType(type);
  return (
    normalized.includes('textfield') ||
    normalized.includes('securetextfield') ||
    normalized.includes('searchfield') ||
    normalized.includes('edittext') ||
    normalized.includes('textview') ||
    normalized.includes('textarea')
  );
}

function isMeaningfulReadableIdentifier(value: string): boolean {
  if (!value) {
    return false;
  }
  return !/^[\w.]+:id\/[\w.-]+$/i.test(value) && !/^_?NS:\d+$/i.test(value);
}
