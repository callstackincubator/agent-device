import type { SnapshotState } from '../utils/snapshot.ts';
import { extractNodeText } from './snapshot-processing.ts';
import { isNodeEditable, isNodeVisible } from './selectors.ts';

export type IsPredicate = 'visible' | 'hidden' | 'exists' | 'editable' | 'selected' | 'text';

export function isSupportedPredicate(input: string): input is IsPredicate {
  return ['visible', 'hidden', 'exists', 'editable', 'selected', 'text'].includes(input);
}

export function evaluateIsPredicate(params: {
  predicate: Exclude<IsPredicate, 'exists'>;
  node: SnapshotState['nodes'][number];
  expectedText?: string;
  platform: 'ios' | 'android';
}): { pass: boolean; actualText: string; details: string } {
  const { predicate, node, expectedText, platform } = params;
  const actualText = extractNodeText(node);
  let pass = false;
  switch (predicate) {
    case 'visible':
      pass = isNodeVisible(node);
      break;
    case 'hidden':
      pass = !isNodeVisible(node);
      break;
    case 'editable':
      pass = isNodeEditable(node, platform);
      break;
    case 'selected':
      pass = node.selected === true;
      break;
    case 'text':
      pass = actualText === (expectedText ?? '');
      break;
  }
  const details =
    predicate === 'text'
      ? `expected="${expectedText ?? ''}" actual="${actualText}"`
      : `actual=${JSON.stringify({
          visible: isNodeVisible(node),
          editable: isNodeEditable(node, platform),
          selected: node.selected === true,
        })}`;
  return { pass, actualText, details };
}
