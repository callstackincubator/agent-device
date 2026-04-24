import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  AGENT_REACT_DEVTOOLS_PACKAGE,
  buildReactDevtoolsNpmExecArgs,
} from '../cli/commands/react-devtools.ts';

test('react-devtools passthrough pins agent-react-devtools package version', () => {
  assert.equal(AGENT_REACT_DEVTOOLS_PACKAGE, 'agent-react-devtools@0.4.0');
  assert.deepEqual(buildReactDevtoolsNpmExecArgs(['get', 'tree', '--depth', '3']), [
    'exec',
    '--yes',
    '--package',
    'agent-react-devtools@0.4.0',
    '--',
    'agent-react-devtools',
    'get',
    'tree',
    '--depth',
    '3',
  ]);
});
