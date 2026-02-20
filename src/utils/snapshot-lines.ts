import type { SnapshotNode } from './snapshot.ts';

export type SnapshotDisplayLine = {
  node: SnapshotNode;
  depth: number;
  type: string;
  text: string;
};

export function buildSnapshotDisplayLines(nodes: SnapshotNode[]): SnapshotDisplayLine[] {
  const hiddenGroupDepths: number[] = [];
  const lines: SnapshotDisplayLine[] = [];
  for (const node of nodes) {
    const depth = node.depth ?? 0;
    while (hiddenGroupDepths.length > 0 && depth <= hiddenGroupDepths[hiddenGroupDepths.length - 1]) {
      hiddenGroupDepths.pop();
    }
    const label = node.label?.trim() || node.value?.trim() || node.identifier?.trim() || '';
    const type = formatRole(node.type ?? 'Element');
    const isHiddenGroup = type === 'group' && !label;
    if (isHiddenGroup) {
      hiddenGroupDepths.push(depth);
    }
    const adjustedDepth = isHiddenGroup ? depth : Math.max(0, depth - hiddenGroupDepths.length);
    lines.push({
      node,
      depth: adjustedDepth,
      type,
      text: formatSnapshotLine(node, adjustedDepth, isHiddenGroup, type),
    });
  }
  return lines;
}

export function formatSnapshotLine(
  node: SnapshotNode,
  depth: number,
  hiddenGroup: boolean,
  normalizedType?: string,
): string {
  const type = normalizedType ?? formatRole(node.type ?? 'Element');
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
  if (isGenericResourceId(identifier) && (type === 'group' || type === 'image' || type === 'list' || type === 'collection')) {
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
