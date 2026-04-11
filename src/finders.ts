export type { FindLocator } from './utils/finders.ts';
export type { SnapshotNode } from './utils/snapshot.ts';
export { normalizeRole, normalizeText, parseFindArgs } from './utils/finders.ts';

import {
  findBestMatchesByLocator as findBestMatchesByLocatorInternal,
  type FindLocator,
} from './utils/finders.ts';
import type { SnapshotNode } from './utils/snapshot.ts';

export type FindMatchOptions = {
  requireRect?: boolean;
};

export function findBestMatchesByLocator(
  nodes: SnapshotNode[],
  locator: FindLocator,
  query: string,
  options?: boolean | FindMatchOptions,
) {
  const matchOptions = typeof options === 'boolean' ? { requireRect: options } : options;
  return findBestMatchesByLocatorInternal(nodes, locator, query, matchOptions);
}
