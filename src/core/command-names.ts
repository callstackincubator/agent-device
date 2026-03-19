/**
 * Canonical command name type used throughout agent-device.
 *
 * CLI command names are derived from `COMMAND_SCHEMAS` keys.
 * Daemon-internal names are listed as a small separate union.
 *
 * `DaemonRequest.command` intentionally stays `string` because it represents
 * untrusted input from wire boundaries.  The value of `CommandName` comes from
 * typed lookup-table keys and internal function parameters.
 */

import type { CliCommandName } from '../utils/command-schema.ts';

const DAEMON_INTERNAL_COMMANDS = [
  'install_source',
  'lease_allocate',
  'lease_heartbeat',
  'lease_release',
  'release_materialized_paths',
  'session_list',
] as const;

type DaemonInternalCommandName = (typeof DAEMON_INTERNAL_COMMANDS)[number];

export type CommandName = CliCommandName | DaemonInternalCommandName;

/** CLI aliases that are normalized before reaching command dispatch. */
export const COMMAND_ALIASES: Record<string, CommandName> = {
  'long-press': 'longpress',
  metrics: 'perf',
};
