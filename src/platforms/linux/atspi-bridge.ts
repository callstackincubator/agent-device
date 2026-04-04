/**
 * AT-SPI2 bridge using node-gtk and GObject Introspection.
 *
 * Lazily loads `node-gtk` so the native dependency is only required on Linux
 * at runtime, never on macOS/Windows.
 */

import { AppError } from '../../utils/errors.ts';
import type { RawSnapshotNode } from '../../utils/snapshot.ts';
import { normalizeAtspiRole } from './role-map.ts';

// ── Limits (matching macOS helper's SnapshotTraversalLimits) ────────────
const MAX_DESKTOP_APPS = 24;
const MAX_NODES = 1500;
const MAX_DEPTH = 12;

// ── Lazy GI loading ──────���─────────────────────────────────────────────
// The types here are deliberately `any` — node-gtk and the Atspi typelib
// are only available at runtime on Linux, and there are no ambient type
// declarations we can rely on in CI / macOS builds.

/* eslint-disable @typescript-eslint/no-explicit-any */
let gi: any = null;
let Atspi: any = null;
let atspiInitialized = false;

async function ensureAtspi(): Promise<void> {
  if (atspiInitialized) return;

  if (process.platform !== 'linux') {
    throw new AppError(
      'UNSUPPORTED_PLATFORM',
      'AT-SPI2 bridge is only available on Linux',
    );
  }

  try {
    gi = await import('node-gtk');
    Atspi = gi.require('Atspi', '2.0');
    gi.startLoop();
    Atspi.init();
    atspiInitialized = true;
  } catch (err) {
    throw new AppError(
      'TOOL_MISSING',
      'Failed to load AT-SPI2 via node-gtk. Ensure at-spi2-core, gir1.2-atspi-2.0, and node-gtk are installed.',
      { cause: err },
    );
  }
}

// ��─ State types (AT-SPI2 StateType enum values) ────────────────────────
// We reference these by name through the loaded Atspi module to avoid
// hard-coding numeric constants that could drift across versions.

function hasState(stateSet: any, stateName: string): boolean {
  try {
    const stateType = Atspi.StateType[stateName];
    if (stateType == null) return false;
    return stateSet.contains(stateType);
  } catch {
    return false;
  }
}

// ── Tree traversal ────────���────────────────────────────────────────────

export type TraversalOptions = {
  maxNodes?: number;
  maxDepth?: number;
  maxApps?: number;
};

type TraversalContext = {
  nodes: RawSnapshotNode[];
  maxNodes: number;
  maxDepth: number;
  visited: WeakSet<object>;
};

function getRect(accessible: any): { x: number; y: number; width: number; height: number } | undefined {
  try {
    const component = accessible.getComponent();
    if (!component) return undefined;
    const extents = component.getExtents(Atspi.CoordType.SCREEN);
    if (!extents) return undefined;
    const { x, y, width, height } = extents;
    // Filter out invalid/zero rects
    if (width <= 0 && height <= 0) return undefined;
    return { x, y, width, height };
  } catch {
    return undefined;
  }
}

function getTextValue(accessible: any): string | undefined {
  try {
    const text = accessible.getText();
    if (!text) return undefined;
    const charCount = text.getCharacterCount();
    if (charCount <= 0) return undefined;
    const value = text.getText(0, charCount);
    return value || undefined;
  } catch {
    return undefined;
  }
}

function getNumericValue(accessible: any): string | undefined {
  try {
    const value = accessible.getValue();
    if (!value) return undefined;
    const current = value.getCurrentValue();
    if (current == null) return undefined;
    return String(current);
  } catch {
    return undefined;
  }
}

function getNodeValue(accessible: any): string | undefined {
  return getTextValue(accessible) ?? getNumericValue(accessible);
}

function traverseNode(
  accessible: any,
  depth: number,
  parentIndex: number | undefined,
  ctx: TraversalContext,
  appInfo: { appName?: string; pid?: number },
  windowTitle?: string,
): void {
  if (ctx.nodes.length >= ctx.maxNodes) return;
  if (depth > ctx.maxDepth) return;
  if (!accessible) return;

  // Deduplicate — some toolkits expose the same object via multiple paths
  if (ctx.visited.has(accessible)) return;
  ctx.visited.add(accessible);

  const roleName = accessible.getRoleName?.() ?? 'unknown';
  const name = accessible.getName?.() ?? '';
  const description = accessible.getDescription?.() ?? '';
  const label = name || description || undefined;
  const rect = getRect(accessible);

  let stateSet: any;
  try {
    stateSet = accessible.getStateSet();
  } catch {
    stateSet = null;
  }
  const enabled = stateSet ? hasState(stateSet, 'ENABLED') : undefined;
  const selected = stateSet ? hasState(stateSet, 'SELECTED') : undefined;
  const visible = stateSet ? hasState(stateSet, 'VISIBLE') : true;
  const showing = stateSet ? hasState(stateSet, 'SHOWING') : true;
  const hittable = enabled !== false && visible && showing && rect != null;

  // Resolve window title at the top of each subtree
  const currentWindowTitle =
    windowTitle ??
    (roleName === 'frame' || roleName === 'window' || roleName === 'dialog'
      ? label
      : undefined);

  const nodeIndex = ctx.nodes.length;
  const value = getNodeValue(accessible);

  const node: RawSnapshotNode = {
    index: nodeIndex,
    type: normalizeAtspiRole(roleName),
    role: roleName,
    label,
    value,
    rect,
    enabled,
    selected,
    hittable,
    depth,
    parentIndex,
    pid: appInfo.pid,
    appName: appInfo.appName,
    windowTitle: currentWindowTitle ?? windowTitle,
  };

  ctx.nodes.push(node);

  // Recurse into children
  let childCount = 0;
  try {
    childCount = accessible.getChildCount?.() ?? 0;
  } catch {
    // Some defunct objects throw when queried
    return;
  }

  for (let i = 0; i < childCount; i++) {
    if (ctx.nodes.length >= ctx.maxNodes) break;
    try {
      const child = accessible.getChildAtIndex(i);
      if (!child) continue;
      traverseNode(child, depth + 1, nodeIndex, ctx, appInfo, currentWindowTitle ?? windowTitle);
    } catch {
      // Skip inaccessible children (defunct, etc.)
    }
  }
}

// ── Public API ──────────────────────────────────���───────────────────────

export type SnapshotSurface = 'desktop' | 'frontmost-app';

export async function captureAccessibilityTree(
  surface: SnapshotSurface,
  options: TraversalOptions = {},
): Promise<{
  nodes: RawSnapshotNode[];
  truncated: boolean;
  surface: SnapshotSurface;
}> {
  await ensureAtspi();

  const maxNodes = options.maxNodes ?? MAX_NODES;
  const maxDepth = options.maxDepth ?? MAX_DEPTH;
  const maxApps = options.maxApps ?? MAX_DESKTOP_APPS;

  const ctx: TraversalContext = {
    nodes: [],
    maxNodes,
    maxDepth,
    visited: new WeakSet(),
  };

  const desktop = Atspi.getDesktop(0);
  if (!desktop) {
    throw new AppError(
      'COMMAND_FAILED',
      'AT-SPI2: Could not get desktop accessible. Is the accessibility bus running?',
    );
  }

  const appCount = desktop.getChildCount?.() ?? 0;

  if (surface === 'frontmost-app') {
    const focusedApp = findFocusedApplication(desktop, appCount);
    if (focusedApp) {
      const appInfo = {
        appName: focusedApp.getName?.() || undefined,
        pid: focusedApp.getProcessId?.() ?? undefined,
      };
      traverseNode(focusedApp, 0, undefined, ctx, appInfo);
    }
  } else {
    // Desktop surface: traverse all applications
    const appsToTraverse = Math.min(appCount, maxApps);
    for (let i = 0; i < appsToTraverse; i++) {
      if (ctx.nodes.length >= maxNodes) break;
      try {
        const app = desktop.getChildAtIndex(i);
        if (!app) continue;
        // Skip apps with no children (not visible / no UI)
        const childCount = app.getChildCount?.() ?? 0;
        if (childCount === 0) continue;
        const appInfo = {
          appName: app.getName?.() || undefined,
          pid: app.getProcessId?.() ?? undefined,
        };
        traverseNode(app, 0, undefined, ctx, appInfo);
      } catch {
        // Skip inaccessible apps
      }
    }
  }

  return {
    nodes: ctx.nodes,
    truncated: ctx.nodes.length >= maxNodes,
    surface,
  };
}

function findFocusedApplication(desktop: any, appCount: number): any | null {
  for (let i = 0; i < appCount; i++) {
    try {
      const app = desktop.getChildAtIndex(i);
      if (!app) continue;
      const childCount = app.getChildCount?.() ?? 0;
      for (let j = 0; j < childCount; j++) {
        try {
          const win = app.getChildAtIndex(j);
          if (!win) continue;
          const stateSet = win.getStateSet?.();
          if (stateSet && hasState(stateSet, 'ACTIVE')) {
            return app;
          }
        } catch {
          // skip
        }
      }
    } catch {
      // skip
    }
  }
  // Fallback: return the first app with any children
  for (let i = 0; i < appCount; i++) {
    try {
      const app = desktop.getChildAtIndex(i);
      if (app && (app.getChildCount?.() ?? 0) > 0) return app;
    } catch {
      // skip
    }
  }
  return null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
