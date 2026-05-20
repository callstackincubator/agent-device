export const PUBLIC_COMMANDS = {
  alert: 'alert',
  appState: 'appstate',
  appSwitcher: 'app-switcher',
  apps: 'apps',
  back: 'back',
  batch: 'batch',
  boot: 'boot',
  click: 'click',
  close: 'close',
  clipboard: 'clipboard',
  devices: 'devices',
  diff: 'diff',
  fill: 'fill',
  find: 'find',
  focus: 'focus',
  get: 'get',
  home: 'home',
  install: 'install',
  installFromSource: 'install-from-source',
  is: 'is',
  keyboard: 'keyboard',
  logs: 'logs',
  longPress: 'longpress',
  network: 'network',
  open: 'open',
  perf: 'perf',
  pinch: 'pinch',
  press: 'press',
  push: 'push',
  record: 'record',
  reactNative: 'react-native',
  reinstall: 'reinstall',
  replay: 'replay',
  rotate: 'rotate',
  scroll: 'scroll',
  screenshot: 'screenshot',
  settings: 'settings',
  snapshot: 'snapshot',
  swipe: 'swipe',
  test: 'test',
  trace: 'trace',
  triggerAppEvent: 'trigger-app-event',
  type: 'type',
  wait: 'wait',
} as const;

export const INTERNAL_COMMANDS = {
  installSource: 'install_source',
  leaseAllocate: 'lease_allocate',
  leaseHeartbeat: 'lease_heartbeat',
  leaseRelease: 'lease_release',
  releaseMaterializedPaths: 'release_materialized_paths',
  sessionList: 'session_list',
} as const;

export type PublicCommandName = (typeof PUBLIC_COMMANDS)[keyof typeof PUBLIC_COMMANDS];
export type CliCommandName =
  | PublicCommandName
  | 'auth'
  | 'connect'
  | 'connection'
  | 'disconnect'
  | 'metro'
  | 'session';

export const DAEMON_COMMAND_GROUPS = {
  inventory: commandSet(
    INTERNAL_COMMANDS.sessionList,
    PUBLIC_COMMANDS.devices,
    PUBLIC_COMMANDS.apps,
  ),
  state: commandSet(PUBLIC_COMMANDS.boot, PUBLIC_COMMANDS.appState),
  observability: commandSet(PUBLIC_COMMANDS.perf, PUBLIC_COMMANDS.logs, PUBLIC_COMMANDS.network),
  replay: commandSet(PUBLIC_COMMANDS.replay, PUBLIC_COMMANDS.test),
  snapshot: commandSet(
    PUBLIC_COMMANDS.snapshot,
    PUBLIC_COMMANDS.diff,
    PUBLIC_COMMANDS.wait,
    PUBLIC_COMMANDS.alert,
    PUBLIC_COMMANDS.settings,
  ),
  replayScopedAction: commandSet(
    PUBLIC_COMMANDS.alert,
    PUBLIC_COMMANDS.back,
    PUBLIC_COMMANDS.click,
    PUBLIC_COMMANDS.clipboard,
    PUBLIC_COMMANDS.diff,
    PUBLIC_COMMANDS.fill,
    PUBLIC_COMMANDS.find,
    PUBLIC_COMMANDS.get,
    PUBLIC_COMMANDS.home,
    PUBLIC_COMMANDS.is,
    PUBLIC_COMMANDS.keyboard,
    PUBLIC_COMMANDS.longPress,
    PUBLIC_COMMANDS.pinch,
    PUBLIC_COMMANDS.press,
    PUBLIC_COMMANDS.record,
    PUBLIC_COMMANDS.reactNative,
    PUBLIC_COMMANDS.rotate,
    PUBLIC_COMMANDS.screenshot,
    PUBLIC_COMMANDS.scroll,
    PUBLIC_COMMANDS.settings,
    PUBLIC_COMMANDS.snapshot,
    PUBLIC_COMMANDS.swipe,
    PUBLIC_COMMANDS.type,
    PUBLIC_COMMANDS.wait,
  ),
  selectorValidationExempt: commandSet(
    INTERNAL_COMMANDS.sessionList,
    PUBLIC_COMMANDS.devices,
    INTERNAL_COMMANDS.releaseMaterializedPaths,
  ),
  leaseAdmissionExempt: commandSet(
    INTERNAL_COMMANDS.sessionList,
    PUBLIC_COMMANDS.devices,
    INTERNAL_COMMANDS.releaseMaterializedPaths,
    INTERNAL_COMMANDS.leaseAllocate,
    INTERNAL_COMMANDS.leaseHeartbeat,
    INTERNAL_COMMANDS.leaseRelease,
  ),
} as const;

function commandSet(...commands: readonly string[]): ReadonlySet<string> {
  return new Set(commands);
}
