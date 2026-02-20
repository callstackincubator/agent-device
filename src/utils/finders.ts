import type { SnapshotNode } from './snapshot.ts';

export type FindLocator = 'any' | 'text' | 'label' | 'value' | 'role' | 'id';

type FindMatchOptions = {
  requireRect?: boolean;
};

type FindBestMatches = {
  matches: SnapshotNode[];
  score: number;
};

export function findNodeByLocator(
  nodes: SnapshotNode[],
  locator: FindLocator,
  query: string,
  options: FindMatchOptions = {},
): SnapshotNode | null {
  const best = findBestMatchesByLocator(nodes, locator, query, options);
  return best.matches[0] ?? null;
}

export function findBestMatchesByLocator(
  nodes: SnapshotNode[],
  locator: FindLocator,
  query: string,
  options: FindMatchOptions = {},
): FindBestMatches {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return { matches: [], score: 0 };
  let bestScore = 0;
  const matches: SnapshotNode[] = [];
  for (const node of nodes) {
    if (options.requireRect && !node.rect) continue;
    const score = matchNode(node, locator, normalizedQuery);
    if (score <= 0) continue;
    if (score > bestScore) {
      bestScore = score;
      matches.length = 0;
      matches.push(node);
      continue;
    }
    if (score === bestScore) {
      matches.push(node);
    }
  }
  return { matches, score: bestScore };
}

function matchNode(node: SnapshotNode, locator: FindLocator, query: string): number {
  switch (locator) {
    case 'role':
      return matchRole(node.type, query);
    case 'label':
      return matchText(node.label, query);
    case 'value':
      return matchText(node.value, query);
    case 'id':
      return matchText(node.identifier, query);
    case 'text':
    case 'any':
    default:
      return Math.max(
        matchText(node.label, query),
        matchText(node.value, query),
        matchText(node.identifier, query),
      );
  }
}

function matchText(value: string | undefined, query: string): number {
  const normalized = normalizeText(value ?? '');
  if (!normalized) return 0;
  if (normalized === query) return 2;
  if (normalized.includes(query)) return 1;
  return 0;
}

function matchRole(value: string | undefined, query: string): number {
  const normalized = normalizeRole(value ?? '');
  if (!normalized) return 0;
  if (normalized === query) return 2;
  if (normalized.includes(query)) return 1;
  return 0;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeRole(value: string): string {
  let normalized = value.trim();
  if (!normalized) return '';
  const lastSegment = normalized.split('.').pop() ?? normalized;
  normalized = lastSegment.replace(/XCUIElementType/gi, '').toLowerCase();
  return normalized;
}
