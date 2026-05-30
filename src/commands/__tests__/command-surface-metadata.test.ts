import assert from 'node:assert/strict';
import { test } from 'vitest';
import { listMcpExposedCommandNames } from '../../command-catalog.ts';
import { listCommandMetadataNames, listMcpCommandMetadata } from '../command-metadata.ts';
import { listExecutableCommandNames } from '../command-surface.ts';

test('MCP exposed command names have metadata and executable command definitions', () => {
  const mcpExposedNames = listMcpExposedCommandNames().sort();
  const mcpMetadataNames = listMcpCommandMetadata()
    .map((definition) => definition.name)
    .sort();
  const metadataNames = new Set<string>(listCommandMetadataNames());
  const executableNames = new Set<string>(listExecutableCommandNames());

  assert.deepEqual(mcpMetadataNames, mcpExposedNames);

  for (const name of mcpExposedNames) {
    assert.ok(metadataNames.has(name), `${name} must have command metadata`);
    assert.ok(executableNames.has(name), `${name} must have an executable command definition`);
  }
});
