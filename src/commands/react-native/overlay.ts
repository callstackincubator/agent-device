import { centerOfRect, type Point, type SnapshotNode } from '../../utils/snapshot.ts';
import {
  hasKnownReactNativeOverlayText,
  isReactNativeCollapsedWarningLabel,
  isReactNativeOpenDebuggerWarningLabel,
  isReactNativeStackFrame,
} from '../../utils/react-native-overlay-signals.ts';

export type ReactNativeOverlayState = {
  detected: boolean;
  redBox: boolean;
  dismissRefs: string[];
  minimizeRefs: string[];
  collapsedRefs: string[];
  dismissNodes: SnapshotNode[];
  minimizeNodes: SnapshotNode[];
  collapsedNodes: SnapshotNode[];
};

export type ReactNativeOverlayDismissTarget = {
  action: 'close' | 'dismiss' | 'minimize' | 'close-collapsed-banner';
  point: Point;
  ref?: string;
  label?: string;
  warning?: string;
};

export function formatReactNativeOverlayWarning(nodes: SnapshotNode[]): string | undefined {
  const overlay = detectReactNativeOverlay(nodes);
  if (!overlay.detected) return undefined;
  return [
    'Hint: React Native warning/error overlay detected. It overlays part of the app and should be handled before interacting.',
    'Run: agent-device react-native dismiss-overlay',
    'Then run: agent-device snapshot -i -c',
    'Use refs from the new snapshot.',
  ].join('\n');
}

export function detectReactNativeOverlay(nodes: SnapshotNode[]): ReactNativeOverlayState {
  const text = nodes
    .map((node) =>
      [node.label, node.value, node.identifier, node.type, node.role].filter(Boolean).join(' '),
    )
    .join('\n')
    .toLowerCase();

  const dismissNodes = collectOverlayNodes(nodes, isDismissControlLabel);
  const minimizeNodes = collectOverlayNodes(nodes, isMinimizeLabel);
  const collapsedNodes = collectOverlayNodes(
    nodes,
    isReactNativeCollapsedWarningLabel,
    isLikelyCollapsedWarningControl,
  );
  const openDebuggerWarningNodes = collectOverlayNodes(
    nodes,
    isReactNativeOpenDebuggerWarningLabel,
  );
  const dismissRefs = refsOf(dismissNodes);
  const minimizeRefs = refsOf(minimizeNodes);
  const collapsedRefs = refsOf(collapsedNodes);
  const hasReactNativeStackFrame = isReactNativeStackFrame(text);
  const hasOverlayControl =
    dismissRefs.length > 0 || minimizeRefs.length > 0 || /\b(reload js|copy stack)\b/.test(text);
  const redBox =
    /\b(redbox|runtime error|reload js|copy stack|component stack|call stack)\b/.test(text) ||
    (hasReactNativeStackFrame && hasOverlayControl);
  const detected =
    collapsedRefs.length > 0 ||
    openDebuggerWarningNodes.length > 0 ||
    (hasOverlayControl && (hasKnownReactNativeOverlayText(text) || hasReactNativeStackFrame));
  return {
    detected,
    redBox,
    dismissRefs,
    minimizeRefs,
    collapsedRefs,
    dismissNodes,
    minimizeNodes,
    collapsedNodes,
  };
}

export function resolveReactNativeOverlayDismissTarget(
  nodes: SnapshotNode[],
): ReactNativeOverlayDismissTarget | null {
  const overlay = detectReactNativeOverlay(nodes);
  if (!overlay.detected) return null;

  if (overlay.redBox) {
    const minimize = firstNodeWithRect(overlay.minimizeNodes);
    if (minimize) return targetFromNode(minimize, 'minimize');
    const dismiss = firstNodeWithRect(overlay.dismissNodes);
    return dismiss
      ? {
          ...targetFromNode(dismiss, actionFromDismissNode(dismiss)),
          warning: 'RedBox Minimize control was not exposed; used Dismiss fallback',
        }
      : null;
  }

  const dismiss = firstNodeWithRect(overlay.dismissNodes);
  if (dismiss) return targetFromNode(dismiss, actionFromDismissNode(dismiss));

  const collapsed = chooseCollapsedWarningNode(overlay.collapsedNodes);
  if (!collapsed?.rect) return null;
  return {
    action: 'close-collapsed-banner',
    point: collapsedBannerClosePoint(collapsed),
    ref: collapsed.ref,
    label: readNodeLabel(collapsed),
  };
}

function isDismissControlLabel(label: string): boolean {
  return label === 'dismiss' || label === 'close' || isCloseIconLabel(label);
}

function isCloseIconLabel(label: string): boolean {
  return ['x', '×', '✕', '✖', '⨯'].includes(label);
}

function isMinimizeLabel(label: string): boolean {
  return /^minimi[sz]e$/.test(label);
}

function isLikelyCollapsedWarningControl(node: SnapshotNode): boolean {
  return !node.rect || node.rect.height <= 180;
}

function collectOverlayNodes(
  nodes: SnapshotNode[],
  matches: (label: string) => boolean,
  includeNode: (node: SnapshotNode) => boolean = () => true,
): SnapshotNode[] {
  const matchedNodes: SnapshotNode[] = [];
  for (const node of nodes) {
    if (!node.ref) continue;
    if (!includeNode(node)) continue;
    const labels = [node.label, node.value, node.identifier]
      .map((value) => value?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value));
    if (!labels.some((label) => matches(label))) continue;
    matchedNodes.push(node);
  }
  return matchedNodes;
}

function refsOf(nodes: SnapshotNode[]): string[] {
  return nodes.map((node) => node.ref);
}

function firstNodeWithRect(nodes: SnapshotNode[]): SnapshotNode | null {
  return nodes.find((node) => node.rect) ?? null;
}

function targetFromNode(
  node: SnapshotNode,
  action: ReactNativeOverlayDismissTarget['action'],
): ReactNativeOverlayDismissTarget {
  if (!node.rect) {
    throw new Error('React Native overlay target node must have rect');
  }
  return {
    action,
    point: centerOfRect(node.rect),
    ref: node.ref,
    label: readNodeLabel(node),
  };
}

function actionFromDismissNode(node: SnapshotNode): ReactNativeOverlayDismissTarget['action'] {
  const label = readNodeLabel(node)?.trim().toLowerCase();
  if (label === 'dismiss') return 'dismiss';
  return 'close';
}

function chooseCollapsedWarningNode(nodes: SnapshotNode[]): SnapshotNode | null {
  const withRect = nodes.filter((node) => node.rect);
  if (withRect.length === 0) return null;
  return withRect.sort((a, b) => {
    const aHittable = a.hittable === true ? 1 : 0;
    const bHittable = b.hittable === true ? 1 : 0;
    if (aHittable !== bHittable) return bHittable - aHittable;
    const aWidth = a.rect?.width ?? 0;
    const bWidth = b.rect?.width ?? 0;
    if (aWidth !== bWidth) return bWidth - aWidth;
    return (b.rect?.y ?? 0) - (a.rect?.y ?? 0);
  })[0];
}

function collapsedBannerClosePoint(node: SnapshotNode): Point {
  if (!node.rect) throw new Error('Collapsed React Native warning node must have rect');
  const closeTargetHeight = Math.min(node.rect.height, 52);
  const inset = Math.min(36, Math.max(18, closeTargetHeight * 0.45));
  return {
    x: Math.round(
      clamp(
        node.rect.x + node.rect.width - inset,
        node.rect.x + 1,
        node.rect.x + node.rect.width - 1,
      ),
    ),
    y: Math.round(node.rect.y + closeTargetHeight / 2),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readNodeLabel(node: SnapshotNode): string | undefined {
  return node.label ?? node.value ?? node.identifier;
}
