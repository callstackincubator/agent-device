import fs from 'node:fs';
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

test('react-devtools docs mention the pinned package version', () => {
  const docs = ['README.md', 'website/docs/docs/commands.md', 'skills/react-devtools/SKILL.md'];

  for (const file of docs) {
    assert.match(fs.readFileSync(file, 'utf8'), new RegExp(AGENT_REACT_DEVTOOLS_PACKAGE));
  }
});
