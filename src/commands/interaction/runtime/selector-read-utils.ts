export { findNodeByLabel, resolveRefLabel } from '../../../utils/snapshot-processing.ts';

export function shouldScopeFind(locator: string): boolean {
  return locator === 'text' || locator === 'label' || locator === 'any';
}
