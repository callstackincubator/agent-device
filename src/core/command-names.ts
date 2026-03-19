/**
 * Canonical command names used throughout agent-device.
 *
 * The `COMMAND_NAMES` array is the single source of truth.
 * `CommandName` is the union type derived from it.
 *
 * `DaemonRequest.command` intentionally stays `string` because it represents
 * untrusted input from wire boundaries.  The value of `CommandName` comes from
 * typed lookup-table keys and internal function parameters.
 */

export const COMMAND_NAMES = [
  // CLI commands (46)
  'alert',
  'app-switcher',
  'apps',
  'appstate',
  'back',
  'batch',
  'boot',
  'click',
  'clipboard',
  'close',
  'devices',
  'diff',
  'ensure-simulator',
  'fill',
  'find',
  'focus',
  'get',
  'home',
  'install',
  'install-from-source',
  'is',
  'keyboard',
  'logs',
  'longpress',
  'metro',
  'network',
  'open',
  'perf',
  'pinch',
  'press',
  'push',
  'record',
  'reinstall',
  'replay',
  'runtime',
  'screenshot',
  'scroll',
  'scrollintoview',
  'session',
  'settings',
  'snapshot',
  'swipe',
  'trace',
  'trigger-app-event',
  'type',
  'wait',

  // Daemon-internal (6)
  'install_source',
  'lease_allocate',
  'lease_heartbeat',
  'lease_release',
  'release_materialized_paths',
  'session_list',
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];

/** CLI aliases that are normalized before reaching command dispatch. */
export const COMMAND_ALIASES: Record<string, CommandName> = {
  'long-press': 'longpress',
  metrics: 'perf',
};