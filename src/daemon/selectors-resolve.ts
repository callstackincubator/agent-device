import type { SnapshotNode, SnapshotState } from '../utils/snapshot.ts';
import type { Selector, SelectorChain } from './selectors-parse.ts';
import { matchesSelector } from './selectors-match.ts';

export type SelectorDiagnostics = {
  selector: string;
  matches: number;
};

type SelectorResolution = {
  node: SnapshotNode;
  selector: Selector;
  selectorIndex: number;
  matches: number;
  diagnostics: SelectorDiagnostics[];
};

export function resolveSelectorChain(
  nodes: SnapshotState['nodes'],
  chain: SelectorChain,
  options: {
    platform: 'ios' | 'android';
    requireRect?: boolean;
    requireUnique?: boolean;
    disambiguateAmbiguous?: boolean;
  },
): SelectorResolution | null {
  const requireRect = options.requireRect ?? false;
  const requireUnique = options.requireUnique ?? true;
  const disambiguateAmbiguous = options.disambiguateAmbiguous ?? false;
  const diagnostics: SelectorDiagnostics[] = [];
  for (let i = 0; i < chain.selectors.length; i += 1) {
    const selector = chain.selectors[i];
    const summary = analyzeSelectorMatches(nodes, selector, {
      platform: options.platform,
      requireRect,
    });
    diagnostics.push({ selector: selector.raw, matches: summary.count });
    if (summary.count === 0 || !summary.firstNode) continue;
    if (requireUnique && summary.count !== 1) {
      if (!disambiguateAmbiguous) continue;
      const disambiguatedNode = summary.disambiguated;
      if (!disambiguatedNode) continue;
      return {
        node: disambiguatedNode,
        selector,
        selectorIndex: i,
        matches: summary.count,
        diagnostics,
      };
    }
    return {
      node: summary.firstNode,
      selector,
      selectorIndex: i,
      matches: summary.count,
      diagnostics,
    };
  }
  return null;
}

export function findSelectorChainMatch(
  nodes: SnapshotState['nodes'],
  chain: SelectorChain,
  options: {
    platform: 'ios' | 'android';
    requireRect?: boolean;
  },
): { selectorIndex: number; selector: Selector; matches: number; diagnostics: SelectorDiagnostics[] } | null {
  const requireRect = options.requireRect ?? false;
  const diagnostics: SelectorDiagnostics[] = [];
  for (let i = 0; i < chain.selectors.length; i += 1) {
    const selector = chain.selectors[i];
    const matches = countSelectorMatchesOnly(nodes, selector, {
      platform: options.platform,
      requireRect,
    });
    diagnostics.push({ selector: selector.raw, matches });
    if (matches > 0) {
      return { selectorIndex: i, selector, matches, diagnostics };
    }
  }
  return null;
}

export function formatSelectorFailure(
  chain: SelectorChain,
  diagnostics: SelectorDiagnostics[],
  options: { unique?: boolean },
): string {
  const unique = options.unique ?? true;
  if (diagnostics.length === 0) {
    return `Selector did not match: ${chain.raw}`;
  }
  const summary = diagnostics.map((entry) => `${entry.selector} -> ${entry.matches}`).join(', ');
  if (unique) {
    return `Selector did not resolve uniquely (${summary})`;
  }
  return `Selector did not match (${summary})`;
}

function analyzeSelectorMatches(
  nodes: SnapshotState['nodes'],
  selector: Selector,
  options: { platform: 'ios' | 'android'; requireRect: boolean },
): { count: number; firstNode: SnapshotNode | null; disambiguated: SnapshotNode | null } {
  let count = 0;
  let firstNode: SnapshotNode | null = null;
  let best: SnapshotNode | null = null;
  let tie = false;
  for (const node of nodes) {
    if (options.requireRect && !node.rect) continue;
    if (!matchesSelector(node, selector, options.platform)) continue;
    count += 1;
    if (!firstNode) {
      firstNode = node;
    }
    if (!best) {
      best = node;
      continue;
    }
    const comparison = compareDisambiguationCandidates(node, best);
    if (comparison > 0) {
      best = node;
      tie = false;
      continue;
    }
    if (comparison === 0) {
      tie = true;
    }
  }
  return {
    count,
    firstNode,
    disambiguated: tie ? null : best,
  };
}

function countSelectorMatchesOnly(
  nodes: SnapshotState['nodes'],
  selector: Selector,
  options: { platform: 'ios' | 'android'; requireRect: boolean },
): number {
  let count = 0;
  for (const node of nodes) {
    if (options.requireRect && !node.rect) continue;
    if (!matchesSelector(node, selector, options.platform)) continue;
    count += 1;
  }
  return count;
}

function compareDisambiguationCandidates(a: SnapshotNode, b: SnapshotNode): number {
  const depthA = a.depth ?? 0;
  const depthB = b.depth ?? 0;
  if (depthA !== depthB) return depthA > depthB ? 1 : -1;
  const areaA = areaOfNode(a);
  const areaB = areaOfNode(b);
  if (areaA !== areaB) return areaA < areaB ? 1 : -1;
  return 0;
}

function areaOfNode(node: SnapshotNode): number {
  if (!node.rect) return Number.POSITIVE_INFINITY;
  return node.rect.width * node.rect.height;
}
