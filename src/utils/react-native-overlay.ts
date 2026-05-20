import { centerOfRect, type Point, type SnapshotNode } from './snapshot.ts';

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
};

export function formatReactNativeOverlayWarning(nodes: SnapshotNode[]): string | undefined {
  const overlay = detectReactNativeOverlay(nodes);
  if (!overlay.detected) return undefined;
  if (overlay.redBox) return formatRedBoxOverlayWarning(overlay.minimizeRefs);
  if (overlay.dismissRefs.length > 0) {
    return `Possible React Native warning/error overlay detected. Dismiss before continuing: run agent-device react-native dismiss-overlay, then snapshot -i and report the warning/error in the final summary. The dismiss-overlay command targets the close control ${formatRefList(
      overlay.dismissRefs,
    )}; do not press the warning/error text body manually. Use screenshot --overlay-refs only if visual evidence is required.`;
  }
  if (overlay.collapsedRefs.length > 0) {
    return `Possible React Native warning/error overlay detected. Collapsed warning banner detected. If it blocks the target, run agent-device react-native dismiss-overlay, then snapshot -i and report the warning/error in the final summary. The dismiss-overlay command taps the banner close affordance; do not press the collapsed warning banner body manually. Use screenshot --overlay-refs only if visual evidence is required.`;
  }
  return 'Possible React Native warning/error overlay detected. Run agent-device react-native dismiss-overlay before continuing, then snapshot -i and report the warning/error in the final summary. Use screenshot --overlay-refs only if visual evidence is required.';
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
    isCollapsedReactNativeWarningLabel,
    isLikelyCollapsedWarningControl,
  );
  const dismissRefs = refsOf(dismissNodes);
  const minimizeRefs = refsOf(minimizeNodes);
  const collapsedRefs = refsOf(collapsedNodes);
  const hasReactNativeStackFrame = isReactNativeStackFrame(text);
  const hasOverlayControl = dismissRefs.length > 0 || minimizeRefs.length > 0;
  const redBox =
    /\b(redbox|runtime error|reload js|copy stack|component stack|call stack)\b/.test(text) ||
    (hasReactNativeStackFrame && hasOverlayControl);
  const detected =
    hasKnownReactNativeOverlayText(text) ||
    collapsedRefs.length > 0 ||
    (hasReactNativeStackFrame && hasOverlayControl);
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
    return minimize ? targetFromNode(minimize, 'minimize') : null;
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

function formatRedBoxOverlayWarning(minimizeRefs: string[]): string {
  if (minimizeRefs.length > 0) {
    return `Possible React Native warning/error overlay detected. React Native RedBox stack overlay detected. Run agent-device react-native dismiss-overlay before continuing; it will prefer Minimize ${formatRefList(
      minimizeRefs,
    )} over Dismiss. Then snapshot -i and report the error in the final summary.`;
  }
  return 'Possible React Native warning/error overlay detected. React Native RedBox stack overlay detected. Run agent-device react-native dismiss-overlay before continuing. If no safe Minimize/Close target is found, use screenshot --overlay-refs and report the error in the final summary.';
}

function hasKnownReactNativeOverlayText(text: string): boolean {
  return /\b(logbox|redbox|reload js|copy stack|component stack|call stack|runtime error|open debugger to view warnings)\b/.test(
    text,
  );
}

function isReactNativeStackFrame(text: string): boolean {
  return (
    /\b[\w.$<>/-]+\.(?:tsx?|jsx?):\d+(?::\d+)?\b/.test(text) ||
    /\b[\w.$<>/-]+\.(?:tsx?|jsx?)\s+\(\d+:\d+\)/.test(text)
  );
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

function isCollapsedReactNativeWarningLabel(label: string): boolean {
  return (
    label.includes('open debugger to view warnings') ||
    /^!,\s+/.test(label) ||
    /^(warn|warning|error):\s+/.test(label) ||
    /\b(?:possible\s+)?unhandled (?:promise )?rejection\b/.test(label) ||
    label.includes('getsnapshot should be cached to avoid an infinite loop') ||
    label.includes('unique "key" prop') ||
    label.includes("unique 'key' prop") ||
    label.includes('virtualizedlists should never be nested') ||
    label.includes('failed prop type')
  );
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
    if (!labels.some(matches)) continue;
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
  const inset = Math.min(36, Math.max(18, node.rect.height * 0.45));
  return {
    x: Math.round(
      clamp(
        node.rect.x + node.rect.width - inset,
        node.rect.x + 1,
        node.rect.x + node.rect.width - 1,
      ),
    ),
    y: Math.round(node.rect.y + node.rect.height / 2),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readNodeLabel(node: SnapshotNode): string | undefined {
  return node.label ?? node.value ?? node.identifier;
}

function formatRefList(refs: string[]): string {
  return refs
    .slice(0, 3)
    .map((ref) => `@${ref}`)
    .join(', ');
}
