export {
  parseWaitPositionals,
  readWaitOptionsFromPositionals,
} from './semantic-grammar/capture.ts';
export {
  readFillTargetFromPositionals,
  readInteractionTargetFromPositionals,
  readLongPressTargetFromPositionals,
} from './semantic-grammar/interactions.ts';
export {
  prepareSemanticBatchStep,
  prepareSemanticDaemonRequest,
  readSemanticInputFromCli,
  semanticBatchCommandNames,
  type SemanticBatchCommand,
  type SemanticDaemonCommand,
} from './semantic-grammar/registry.ts';
export type {
  DecodedFillTarget,
  SemanticDaemonRequest,
  SemanticRequestInput,
  SelectionOptions,
  WaitParsed,
} from './semantic-grammar/types.ts';
