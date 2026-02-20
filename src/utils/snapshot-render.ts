import type { SnapshotNode } from './snapshot.ts';

export type RenderedSnapshotEntry = {
  compareKey: string;
  displayLine: string;
};

export function renderSnapshotEntries(nodes: SnapshotNode[]): RenderedSnapshotEntry[] {
  const hiddenGroupDepths: number[] = [];
  const entries: RenderedSnapshotEntry[] = [];
  for (const node of nodes) {
    const depth = node.depth ?? 0;
    while (hiddenGroupDepths.length > 0 && depth <= hiddenGroupDepths[hiddenGroupDepths.length - 1]) {
      hiddenGroupDepths.pop();
    }
    const type = formatRole(node.type ?? 'Element');
    const label = displayLabel(node, type);
    const isHiddenGroup = type === 'group' && !label;
    if (isHiddenGroup) {
      hiddenGroupDepths.push(depth);
    }
    const adjustedDepth = isHiddenGroup ? depth : Math.max(0, depth - hiddenGroupDepths.length);
    entries.push({
      compareKey: snapshotNodeToComparableLine(node, adjustedDepth),
      displayLine: formatSnapshotDisplayLine(node, adjustedDepth, isHiddenGroup),
    });
  }
  return entries;
}

export function snapshotNodeToComparableLine(node: SnapshotNode, depthOverride?: number): string {
  const type = normalizeType(node.type);
  const label = cleanText(node.label);
  const value = cleanText(node.value);
  const identifier = cleanText(node.identifier);
  const depth =
    typeof depthOverride === 'number'
      ? Math.max(0, Math.floor(depthOverride))
      : typeof node.depth === 'number' && Number.isFinite(node.depth)
        ? Math.max(0, Math.floor(node.depth))
        : 0;
  const tokens: string[] = [];
  if (label) tokens.push(`label="${label}"`);
  if (value) tokens.push(`value="${value}"`);
  if (identifier) tokens.push(`id="${identifier}"`);
  if (node.enabled === false) tokens.push('disabled');
  if (node.selected === true) tokens.push('selected');
  if (node.hittable === false) tokens.push('not-hittable');
  return `${'  '.repeat(depth)}${type}${tokens.length > 0 ? ` ${tokens.join(' ')}` : ''}`;
}

export function formatSnapshotDisplayLine(
  node: SnapshotNode,
  depth: number,
  hiddenGroup: boolean,
): string {
  const type = formatRole(node.type ?? 'Element');
  const label = displayLabel(node, type);
  const indent = '  '.repeat(depth);
  const ref = node.ref ? `@${node.ref}` : '';
  const flags = [node.enabled === false ? 'disabled' : null].filter(Boolean).join(', ');
  const flagText = flags ? ` [${flags}]` : '';
  const textPart = label ? ` "${label}"` : '';
  if (hiddenGroup) {
    return `${indent}${ref} [${type}]${flagText}`.trimEnd();
  }
  return `${indent}${ref} [${type}]${textPart}${flagText}`.trimEnd();
}

function displayLabel(node: SnapshotNode, type: string): string {
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
  if (isGenericResourceId(identifier) && (type === 'group' || type === 'image' || type === 'list' || type === 'collection')) {
    return '';
  }
  return identifier;
}

function isEditableRole(type: string): boolean {
  return type === 'text-field' || type === 'text-view' || type === 'search';
}

function isGenericResourceId(value: string): boolean {
  return /^[\w.]+:id\/[\w.-]+$/i.test(value);
}

function normalizeType(type: string | undefined): string {
  const raw = cleanText(type);
  if (!raw) return 'element';
  return raw.replace(/XCUIElementType/g, '').toLowerCase();
}

function cleanText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function formatRole(type: string): string {
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
