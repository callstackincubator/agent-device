import assert from 'node:assert/strict';
import { test } from 'vitest';
import { DAEMON_COMMAND_GROUPS, INTERNAL_COMMANDS } from '../../command-catalog.ts';
import { FIND_COMMAND_HANDLERS } from '../handlers/find.ts';
import { INTERACTION_COMMAND_HANDLERS } from '../handlers/interaction.ts';
import { handleLeaseCommands, LEASE_COMMAND_HANDLERS } from '../handlers/lease.ts';
import { REACT_NATIVE_COMMAND_HANDLERS } from '../handlers/react-native.ts';
import { RECORD_TRACE_COMMAND_HANDLERS } from '../handlers/record-trace.ts';
import { SESSION_COMMAND_HANDLERS } from '../handlers/session.ts';
import { SNAPSHOT_COMMAND_HANDLERS } from '../handlers/snapshot.ts';
import { LeaseRegistry } from '../lease-registry.ts';

const handlerFamilies = [
  {
    name: 'leaseHandler',
    commands: DAEMON_COMMAND_GROUPS.leaseHandler,
    handlers: LEASE_COMMAND_HANDLERS,
  },
  {
    name: 'sessionHandler',
    commands: DAEMON_COMMAND_GROUPS.sessionHandler,
    handlers: SESSION_COMMAND_HANDLERS,
  },
  {
    name: 'snapshot',
    commands: DAEMON_COMMAND_GROUPS.snapshot,
    handlers: SNAPSHOT_COMMAND_HANDLERS,
  },
  {
    name: 'reactNativeHandler',
    commands: DAEMON_COMMAND_GROUPS.reactNativeHandler,
    handlers: REACT_NATIVE_COMMAND_HANDLERS,
  },
  {
    name: 'recordTraceHandler',
    commands: DAEMON_COMMAND_GROUPS.recordTraceHandler,
    handlers: RECORD_TRACE_COMMAND_HANDLERS,
  },
  {
    name: 'findHandler',
    commands: DAEMON_COMMAND_GROUPS.findHandler,
    handlers: FIND_COMMAND_HANDLERS,
  },
  {
    name: 'interactionHandler',
    commands: DAEMON_COMMAND_GROUPS.interactionHandler,
    handlers: INTERACTION_COMMAND_HANDLERS,
  },
] as const;

test('daemon handler routing groups match handler coverage', () => {
  for (const { name, commands, handlers } of handlerFamilies) {
    assert.deepEqual(
      Object.keys(handlers).sort(),
      [...commands].sort(),
      `${name} catalog must match its handler module`,
    );
  }
});

test('lease handler coverage table points at executable commands', async () => {
  const leaseRegistry = new LeaseRegistry();
  const allocated = leaseRegistry.allocateLease({ tenantId: 'tenant-a', runId: 'run-a' });

  for (const command of Object.keys(LEASE_COMMAND_HANDLERS)) {
    const response = await handleLeaseCommands({
      req: {
        command,
        token: 'test-token',
        session: 'catalog-test',
        flags: {
          tenant: 'tenant-a',
          runId: 'run-a',
          ...(command === INTERNAL_COMMANDS.leaseAllocate ? {} : { leaseId: allocated.leaseId }),
        },
        positionals: [],
      },
      leaseRegistry,
    });

    assert.notEqual(response, null, `${command} should be handled by lease handler`);
  }
});

test('daemon handler routing groups are disjoint', () => {
  const ownerByCommand = new Map<string, string>();
  for (const { name, commands } of handlerFamilies) {
    for (const command of commands) {
      const previousOwner = ownerByCommand.get(command);
      assert.equal(
        previousOwner,
        undefined,
        `${command} is routed by both ${previousOwner} and ${name}`,
      );
      ownerByCommand.set(command, name);
    }
  }
});
