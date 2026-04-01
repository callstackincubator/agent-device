import type { SnapshotNode } from './snapshot.ts';
import { buildTextPreview, describeTextSurface, trimText } from './text-surface.ts';

type SnapshotDisplayLine = {
  node: SnapshotNode;
  depth: number;
  type: string;
  text: string;
};

type SnapshotLineFormatOptions = {
  summarizeTextSurfaces?: boolean;
};

export function buildSnapshotDisplayLines(
  nodes: SnapshotNode[],
  options: SnapshotLineFormatOptions = {},
): SnapshotDisplayLine[] {
  const visibleDepths: number[] = [];
  const lines: SnapshotDisplayLine[] = [];
  for (const node of nodes) {
    const depth = node.depth ?? 0;
    const label = node.label?.trim() || node.value?.trim() || node.identifier?.trim() || '';
    const type = formatRole(node.type ?? 'Element');
    if (type === 'group' && !label) {
      continue;
    }
    while (visibleDepths.length > 0 && depth <= visibleDepths[visibleDepths.length - 1]!) {
      visibleDepths.pop();
    }
    const adjustedDepth = visibleDepths.length;
    visibleDepths.push(depth);
    lines.push({
      node,
      depth: adjustedDepth,
      type,
      text: formatSnapshotLine(node, adjustedDepth, false, type, options),
    });
  }
  return lines;
}

export function formatSnapshotLine(
  node: SnapshotNode,
  depth: number,
  hiddenGroup: boolean,
  normalizedType?: string,
  options: SnapshotLineFormatOptions = {},
): string {
  const type = normalizedType ?? formatRole(node.type ?? 'Element');
  const textSurface = describeTextSurface(node, type);
  const label = resolveDisplayLabel(node, type, options, textSurface);
  const indent = '  '.repeat(depth);
  const ref = node.ref ? `@${node.ref}` : '';
  const metadata = buildLineMetadata(node, type, options, textSurface);
  const metadataText = metadata.map((entry) => ` [${entry}]`).join('');
  const textPart = label ? ` "${label}"` : '';
  if (hiddenGroup) {
    return `${indent}${ref} [${type}]${metadataText}`.trimEnd();
  }
  return `${indent}${ref} [${type}]${textPart}${metadataText}`.trimEnd();
}

export function displayLabel(node: SnapshotNode, type: string): string {
  const label = node.label?.trim();
  const value = node.value?.trim();
  if (isEditableRole(type)) {
    if (value) return value;
    if (label) return label;
  } else if (label) {
    return label;
  }
  if (value) return value;
  const identifier = node.identifier?.trim();
  if (!identifier) return '';
  if (
    isGenericResourceId(identifier) &&
    (type === 'group' || type === 'image' || type === 'list' || type === 'collection')
  ) {
    return '';
  }
  return identifier;
}

export function formatRole(type: string): string {
  const raw = type;
  let normalized = type.replace(/XCUIElementType/gi, '').toLowerCase();
  const isAndroidClass =
    raw.includes('.') &&
    (raw.startsWith('android.') || raw.startsWith('androidx.') || raw.startsWith('com.'));
  if (normalized.includes('.')) {
    normalized = normalized
      .replace(/^android\.widget\./, '')
      .replace(/^android\.view\./, '')
      .replace(/^android\.webkit\./, '')
      .replace(/^androidx\./, '')
      .replace(/^com\.google\.android\./, '')
      .replace(/^com\.android\./, '');
    if (isAndroidClass && normalized.includes('.')) {
      normalized = normalized.slice(normalized.lastIndexOf('.') + 1);
    }
  }
  switch (normalized) {
    case 'application':
      return 'application';
    case 'navigationbar':
      return 'navigation-bar';
    case 'tabbar':
      return 'tab-bar';
    case 'button':
    case 'imagebutton':
      return 'button';
    case 'link':
      return 'link';
    case 'cell':
      return 'cell';
    case 'statictext':
    case 'checkedtextview':
      return 'text';
    case 'textfield':
    case 'edittext':
      return 'text-field';
    case 'textview':
      return isAndroidClass ? 'text' : 'text-view';
    case 'textarea':
      return 'text-view';
    case 'switch':
      return 'switch';
    case 'slider':
      return 'slider';
    case 'image':
    case 'imageview':
      return 'image';
    case 'webview':
      return 'webview';
    case 'framelayout':
    case 'linearlayout':
    case 'relativelayout':
    case 'constraintlayout':
    case 'viewgroup':
    case 'view':
      return 'group';
    case 'listview':
    case 'recyclerview':
      return 'list';
    case 'collectionview':
      return 'collection';
    case 'searchfield':
      return 'search';
    case 'segmentedcontrol':
      return 'segmented-control';
    case 'group':
      return 'group';
    case 'window':
      return 'window';
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio';
    case 'menuitem':
      return 'menu-item';
    case 'toolbar':
      return 'toolbar';
    case 'scrollarea':
    case 'scrollview':
    case 'nestedscrollview':
      return 'scroll-area';
    case 'table':
      return 'table';
    default:
      return normalized || 'element';
  }
}

function isEditableRole(type: string): boolean {
  return type === 'text-field' || type === 'text-view' || type === 'search';
}

function isGenericResourceId(value: string): boolean {
  return /^[\w.]+:id\/[\w.-]+$/i.test(value);
}

function resolveDisplayLabel(
  node: SnapshotNode,
  type: string,
  options: SnapshotLineFormatOptions,
  textSurface: { text: string; isLargeSurface: boolean; shouldSummarize: boolean },
): string {
  if (!options.summarizeTextSurfaces) {
    return displayLabel(node, type);
  }
  if (!textSurface.shouldSummarize) {
    return displayLabel(node, type);
  }
  const semanticLabel = semanticSurfaceLabel(node, type, textSurface.text);
  return semanticLabel || displayLabel(node, type);
}

function buildLineMetadata(
  node: SnapshotNode,
  type: string,
  options: SnapshotLineFormatOptions,
  textSurface: { text: string; isLargeSurface: boolean; shouldSummarize: boolean },
): string[] {
  const metadata: string[] = [];
  if (node.enabled === false) metadata.push('disabled');
  if (!options.summarizeTextSurfaces) {
    return metadata;
  }
  if (node.selected === true) metadata.push('selected');
  if (isEditableRole(type)) metadata.push('editable');
  if (looksScrollable(node, type)) metadata.push('scrollable');
  if (!textSurface.shouldSummarize) {
    return metadata;
  }
  metadata.push(`preview:"${escapePreviewText(buildTextPreview(textSurface.text))}"`);
  metadata.push('truncated');
  return uniqueMetadata(metadata);
}

function semanticSurfaceLabel(node: SnapshotNode, type: string, text: string): string {
  const label = trimText(node.label);
  if (label && label !== text) {
    return label;
  }
  const identifier = trimText(node.identifier);
  if (identifier && !isGenericResourceId(identifier) && identifier !== text) {
    return identifier;
  }
  switch (type) {
    case 'text':
    case 'text-view':
      return 'Text view';
    case 'text-field':
      return 'Text field';
    case 'search':
      return 'Search field';
    default:
      return '';
  }
}

function looksScrollable(node: SnapshotNode, type: string): boolean {
  if (type === 'scroll-area') {
    return true;
  }
  const rawType = (node.type ?? '').toLowerCase();
  const rawRole = `${node.role ?? ''} ${node.subrole ?? ''}`.toLowerCase();
  return rawType.includes('scroll') || rawRole.includes('scroll');
}

function escapePreviewText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function uniqueMetadata(values: string[]): string[] {
  return [...new Set(values)];
}
