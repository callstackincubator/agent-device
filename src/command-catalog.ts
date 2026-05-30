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
  gesture: 'gesture',
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
  runtime: 'runtime',
  sessionList: 'session_list',
} as const;

const LOCAL_CLI_COMMANDS = {
  auth: 'auth',
  connect: 'connect',
  connection: 'connection',
  disconnect: 'disconnect',
  mcp: 'mcp',
  metro: 'metro',
  reactDevtools: 'react-devtools',
  session: 'session',
} as const;

const GESTURE_SUBCOMMANDS = ['pan', 'fling', 'swipe', 'pinch', 'rotate', 'transform'] as const;
export const GESTURE_SUBCOMMAND_ERROR = `gesture requires one of: ${GESTURE_SUBCOMMANDS.join(', ')}`;

export type PublicCommandName = (typeof PUBLIC_COMMANDS)[keyof typeof PUBLIC_COMMANDS];
export type LocalCliCommandName = (typeof LOCAL_CLI_COMMANDS)[keyof typeof LOCAL_CLI_COMMANDS];
export type CliCommandName = PublicCommandName | LocalCliCommandName;
export type ClientBackedCliCommandName =
  | PublicCommandName
  | typeof LOCAL_CLI_COMMANDS.metro
  | typeof LOCAL_CLI_COMMANDS.session;

export const BATCH_COMMAND_NAMES = [
  PUBLIC_COMMANDS.devices,
  PUBLIC_COMMANDS.boot,
  PUBLIC_COMMANDS.apps,
  PUBLIC_COMMANDS.open,
  PUBLIC_COMMANDS.close,
  PUBLIC_COMMANDS.install,
  PUBLIC_COMMANDS.reinstall,
  PUBLIC_COMMANDS.installFromSource,
  PUBLIC_COMMANDS.push,
  PUBLIC_COMMANDS.triggerAppEvent,
  PUBLIC_COMMANDS.snapshot,
  PUBLIC_COMMANDS.screenshot,
  PUBLIC_COMMANDS.diff,
  PUBLIC_COMMANDS.wait,
  PUBLIC_COMMANDS.alert,
  PUBLIC_COMMANDS.settings,
  PUBLIC_COMMANDS.click,
  PUBLIC_COMMANDS.press,
  PUBLIC_COMMANDS.longPress,
  PUBLIC_COMMANDS.swipe,
  PUBLIC_COMMANDS.focus,
  PUBLIC_COMMANDS.type,
  PUBLIC_COMMANDS.fill,
  PUBLIC_COMMANDS.scroll,
  PUBLIC_COMMANDS.get,
  PUBLIC_COMMANDS.gesture,
  PUBLIC_COMMANDS.is,
  PUBLIC_COMMANDS.find,
  PUBLIC_COMMANDS.perf,
  PUBLIC_COMMANDS.logs,
  PUBLIC_COMMANDS.network,
  PUBLIC_COMMANDS.record,
  PUBLIC_COMMANDS.trace,
  PUBLIC_COMMANDS.test,
  PUBLIC_COMMANDS.appState,
  PUBLIC_COMMANDS.back,
  PUBLIC_COMMANDS.home,
  PUBLIC_COMMANDS.rotate,
  PUBLIC_COMMANDS.appSwitcher,
  PUBLIC_COMMANDS.keyboard,
  PUBLIC_COMMANDS.clipboard,
  PUBLIC_COMMANDS.reactNative,
] as const;

const MCP_UNEXPOSED_CLI_COMMANDS = commandSet(
  LOCAL_CLI_COMMANDS.auth,
  LOCAL_CLI_COMMANDS.connect,
  LOCAL_CLI_COMMANDS.connection,
  LOCAL_CLI_COMMANDS.disconnect,
  LOCAL_CLI_COMMANDS.mcp,
  LOCAL_CLI_COMMANDS.reactDevtools,
);

const CAPABILITY_EXEMPT_CLI_COMMANDS = commandSet(
  LOCAL_CLI_COMMANDS.auth,
  LOCAL_CLI_COMMANDS.connect,
  LOCAL_CLI_COMMANDS.connection,
  LOCAL_CLI_COMMANDS.disconnect,
  LOCAL_CLI_COMMANDS.mcp,
  LOCAL_CLI_COMMANDS.metro,
  LOCAL_CLI_COMMANDS.reactDevtools,
  LOCAL_CLI_COMMANDS.session,
  PUBLIC_COMMANDS.appState,
  PUBLIC_COMMANDS.batch,
  PUBLIC_COMMANDS.devices,
  PUBLIC_COMMANDS.gesture,
  PUBLIC_COMMANDS.replay,
  PUBLIC_COMMANDS.test,
  PUBLIC_COMMANDS.trace,
);

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
    PUBLIC_COMMANDS.gesture,
    PUBLIC_COMMANDS.get,
    PUBLIC_COMMANDS.home,
    PUBLIC_COMMANDS.is,
    PUBLIC_COMMANDS.keyboard,
    PUBLIC_COMMANDS.longPress,
    'pinch',
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
  androidBlockingDialogGuardedAction: commandSet(
    PUBLIC_COMMANDS.back,
    PUBLIC_COMMANDS.click,
    PUBLIC_COMMANDS.fill,
    PUBLIC_COMMANDS.focus,
    PUBLIC_COMMANDS.gesture,
    PUBLIC_COMMANDS.home,
    PUBLIC_COMMANDS.keyboard,
    PUBLIC_COMMANDS.longPress,
    'fling',
    'pan',
    'pinch',
    PUBLIC_COMMANDS.press,
    PUBLIC_COMMANDS.rotate,
    'rotate-gesture',
    PUBLIC_COMMANDS.scroll,
    PUBLIC_COMMANDS.swipe,
    'transform-gesture',
    PUBLIC_COMMANDS.type,
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
  // Specialized daemon handler families. Commands absent from these sets fall through to
  // request-generic-dispatch after request admission and provider scoping.
  leaseHandler: commandSet(
    INTERNAL_COMMANDS.leaseAllocate,
    INTERNAL_COMMANDS.leaseHeartbeat,
    INTERNAL_COMMANDS.leaseRelease,
  ),
  sessionHandler: commandSet(
    INTERNAL_COMMANDS.installSource,
    INTERNAL_COMMANDS.releaseMaterializedPaths,
    INTERNAL_COMMANDS.sessionList,
    PUBLIC_COMMANDS.appState,
    PUBLIC_COMMANDS.apps,
    PUBLIC_COMMANDS.batch,
    PUBLIC_COMMANDS.boot,
    PUBLIC_COMMANDS.clipboard,
    PUBLIC_COMMANDS.close,
    PUBLIC_COMMANDS.devices,
    PUBLIC_COMMANDS.install,
    PUBLIC_COMMANDS.keyboard,
    PUBLIC_COMMANDS.logs,
    PUBLIC_COMMANDS.network,
    PUBLIC_COMMANDS.open,
    PUBLIC_COMMANDS.perf,
    PUBLIC_COMMANDS.push,
    PUBLIC_COMMANDS.reinstall,
    PUBLIC_COMMANDS.replay,
    PUBLIC_COMMANDS.test,
    PUBLIC_COMMANDS.triggerAppEvent,
    INTERNAL_COMMANDS.runtime,
  ),
  reactNativeHandler: commandSet(PUBLIC_COMMANDS.reactNative),
  recordTraceHandler: commandSet(PUBLIC_COMMANDS.record, PUBLIC_COMMANDS.trace),
  findHandler: commandSet(PUBLIC_COMMANDS.find),
  interactionHandler: commandSet(
    PUBLIC_COMMANDS.click,
    PUBLIC_COMMANDS.fill,
    PUBLIC_COMMANDS.get,
    PUBLIC_COMMANDS.is,
    PUBLIC_COMMANDS.longPress,
    PUBLIC_COMMANDS.press,
    PUBLIC_COMMANDS.type,
  ),
} as const;

function commandSet(...commands: readonly string[]): ReadonlySet<string> {
  return new Set(commands);
}

export function listCliCommandNames(): CliCommandName[] {
  return [...Object.values(PUBLIC_COMMANDS), ...Object.values(LOCAL_CLI_COMMANDS)].sort();
}

export function isClientBackedCliCommandName(
  command: string,
): command is ClientBackedCliCommandName {
  return (
    Object.values(PUBLIC_COMMANDS).includes(command as PublicCommandName) ||
    command === LOCAL_CLI_COMMANDS.metro ||
    command === LOCAL_CLI_COMMANDS.session
  );
}

export function listMcpExposedCommandNames(): CliCommandName[] {
  return listCliCommandNames().filter((command) => !MCP_UNEXPOSED_CLI_COMMANDS.has(command));
}

export function listCapabilityCheckedCommandNames(): CliCommandName[] {
  return listCliCommandNames().filter((command) => !CAPABILITY_EXEMPT_CLI_COMMANDS.has(command));
}
