import { test, expect } from 'vitest';
import { DAEMON_COMMAND_GROUPS } from '../../../command-catalog.ts';
import { SNAPSHOT_COMMAND_HANDLERS } from '../snapshot.ts';

test('snapshot command catalog has handler coverage', () => {
  for (const command of DAEMON_COMMAND_GROUPS.snapshot) {
    expect(SNAPSHOT_COMMAND_HANDLERS).toHaveProperty(command);
  }
});
