export type {
  Selector,
  SelectorChain,
  SelectorDiagnostics,
  SelectorResolution,
} from './daemon/selectors.ts';

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
