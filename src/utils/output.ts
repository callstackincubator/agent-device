import { AppError } from './errors.ts';

export type JsonResult =
  | { success: true; data?: Record<string, unknown> }
  | { success: false; error: { code: string; message: string; details?: Record<string, unknown> } };

export function printJson(result: JsonResult): void {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function printHumanError(err: AppError): void {
  const details = err.details ? `\n${JSON.stringify(err.details, null, 2)}` : '';
  process.stderr.write(`Error (${err.code}): ${err.message}${details}\n`);
}

type SnapshotRect = { x: number; y: number; width: number; height: number };
type SnapshotNode = {
  ref?: string;
  depth?: number;
  type?: string;
  label?: string;
  value?: string;
  identifier?: string;
  rect?: SnapshotRect;
  hittable?: boolean;
  enabled?: boolean;
};

export function formatSnapshotText(
  data: Record<string, unknown>,
  options: { raw?: boolean } = {},
): string {
  const nodes = (data.nodes ?? []) as SnapshotNode[];
  const truncated = Boolean(data.truncated);
  const appName = typeof data.appName === 'string' ? data.appName : undefined;
  const appBundleId = typeof data.appBundleId === 'string' ? data.appBundleId : undefined;
  const meta: string[] = [];
  if (appName) meta.push(`Page: ${appName}`);
  if (appBundleId) meta.push(`App: ${appBundleId}`);
  const header = `Snapshot: ${nodes.length} nodes${truncated ? ' (truncated)' : ''}`;
  const prefix = meta.length > 0 ? `${meta.join('\n')}\n` : '';
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return `${prefix}${header}\n`;
  }
  if (options.raw) {
    const rawLines = nodes.map((node) => JSON.stringify(node));
    return `${prefix}${header}\n${rawLines.join('\n')}\n`;
  }
  const hiddenGroupDepths: number[] = [];
  const lines: string[] = [];
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
    const adjustedDepth = isHiddenGroup
      ? depth
      : Math.max(0, depth - hiddenGroupDepths.length);
    const indent = '  '.repeat(adjustedDepth);
    const ref = node.ref ? `@${node.ref}` : '';
    const flags = [
      node.enabled === false ? 'disabled' : null,
    ]
      .filter(Boolean)
      .join(', ');
    const flagText = flags ? ` [${flags}]` : '';
    const textPart = label ? ` "${label}"` : '';
    if (isHiddenGroup) {
      lines.push(`${indent}${ref} [${type}]${flagText}`.trimEnd());
      continue;
    }
    lines.push(`${indent}${ref} [${type}]${textPart}${flagText}`.trimEnd());
  }
  return `${prefix}${header}\n${lines.join('\n')}\n`;
}

function formatRole(type: string): string {
  let normalized = type.replace(/XCUIElementType/gi, '').toLowerCase();
  if (normalized.startsWith("ax")) {
    normalized = normalized.replace(/^ax/, "");
  }
  switch (normalized) {
    case 'application':
      return 'application';
    case 'navigationbar':
      return 'navigation-bar';
    case 'tabbar':
      return 'tab-bar';
    case 'button':
      return 'button';
    case 'link':
      return 'link';
    case 'cell':
      return 'cell';
    case 'statictext':
      return 'text';
    case 'textfield':
      return 'text-field';
    case 'textview':
      return 'text-view';
    case 'switch':
      return 'switch';
    case 'slider':
      return 'slider';
    case 'image':
      return 'image';
    case 'table':
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
    case 'statictext':
      return 'text';
    case 'textfield':
      return 'text-field';
    case 'textarea':
      return 'text-view';
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio';
    case 'menuitem':
      return 'menu-item';
    case 'toolbar':
      return 'toolbar';
    case 'scrollarea':
      return 'scroll-area';
    case 'table':
      return 'table';
    default:
      return normalized || 'element';
  }
}
