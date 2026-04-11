export type { FindLocator } from './utils/finders.ts';
export { normalizeRole, normalizeText, parseFindArgs } from './utils/finders.ts';

import {
  findBestMatchesByLocator as findBestMatchesByLocatorInternal,
  type FindLocator,
} from './utils/finders.ts';
import type { SnapshotNode } from './utils/snapshot.ts';

export function findBestMatchesByLocator(
  nodes: SnapshotNode[],
  locator: FindLocator,
  query: string,
  requireRect?: boolean,
) {
  return findBestMatchesByLocatorInternal(nodes, locator, query, { requireRect });
}
