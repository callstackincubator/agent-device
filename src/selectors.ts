export type {
  Selector,
  SelectorChain,
  SelectorDiagnostics,
  SelectorResolution,
} from './daemon/selectors.ts';
export type { SnapshotNode } from './utils/snapshot.ts';

export {
  findSelectorChainMatch,
  formatSelectorFailure,
  isNodeEditable,
  isNodeVisible,
  isSelectorToken,
  parseSelectorChain,
  resolveSelectorChain,
  tryParseSelectorChain,
} from './daemon/selectors.ts';
