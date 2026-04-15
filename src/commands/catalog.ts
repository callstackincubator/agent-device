export type CommandCatalogEntry = {
  command: string;
  category:
    | 'portable-runtime'
    | 'backend-admin'
    | 'transport-session'
    | 'environment'
    | 'capability-gated';
  status: 'implemented' | 'planned';
};

export const commandCatalog: readonly CommandCatalogEntry[] = [
  { command: 'screenshot', category: 'portable-runtime', status: 'implemented' },
  { command: 'diff screenshot', category: 'portable-runtime', status: 'implemented' },
  { command: 'snapshot', category: 'portable-runtime', status: 'implemented' },
  { command: 'diff snapshot', category: 'portable-runtime', status: 'implemented' },
  { command: 'find read-only', category: 'portable-runtime', status: 'implemented' },
  { command: 'get', category: 'portable-runtime', status: 'implemented' },
  { command: 'is', category: 'portable-runtime', status: 'implemented' },
  { command: 'wait', category: 'portable-runtime', status: 'implemented' },
  { command: 'alert', category: 'portable-runtime', status: 'planned' },
  { command: 'click', category: 'portable-runtime', status: 'implemented' },
  { command: 'press', category: 'portable-runtime', status: 'implemented' },
  { command: 'fill', category: 'portable-runtime', status: 'implemented' },
  { command: 'longpress', category: 'portable-runtime', status: 'planned' },
  { command: 'swipe', category: 'portable-runtime', status: 'planned' },
  { command: 'focus', category: 'portable-runtime', status: 'planned' },
  { command: 'type', category: 'portable-runtime', status: 'implemented' },
  { command: 'scroll', category: 'portable-runtime', status: 'planned' },
  { command: 'pinch', category: 'portable-runtime', status: 'planned' },
  { command: 'open', category: 'portable-runtime', status: 'planned' },
  { command: 'close', category: 'portable-runtime', status: 'planned' },
  { command: 'apps', category: 'portable-runtime', status: 'planned' },
  { command: 'appstate', category: 'portable-runtime', status: 'planned' },
  { command: 'back', category: 'portable-runtime', status: 'planned' },
  { command: 'home', category: 'portable-runtime', status: 'planned' },
  { command: 'rotate', category: 'portable-runtime', status: 'planned' },
  { command: 'app-switcher', category: 'portable-runtime', status: 'planned' },
  { command: 'keyboard', category: 'portable-runtime', status: 'planned' },
  { command: 'clipboard', category: 'portable-runtime', status: 'planned' },
  { command: 'settings', category: 'portable-runtime', status: 'planned' },
  { command: 'push', category: 'portable-runtime', status: 'planned' },
  { command: 'trigger-app-event', category: 'portable-runtime', status: 'planned' },
  { command: 'devices', category: 'backend-admin', status: 'planned' },
  { command: 'boot', category: 'backend-admin', status: 'planned' },
  { command: 'ensure-simulator', category: 'backend-admin', status: 'planned' },
  { command: 'install', category: 'backend-admin', status: 'planned' },
  { command: 'reinstall', category: 'backend-admin', status: 'planned' },
  { command: 'install-from-source', category: 'backend-admin', status: 'planned' },
  { command: 'session', category: 'transport-session', status: 'planned' },
  { command: 'connect', category: 'environment', status: 'planned' },
  { command: 'disconnect', category: 'environment', status: 'planned' },
  { command: 'connection', category: 'environment', status: 'planned' },
  { command: 'metro', category: 'environment', status: 'planned' },
  { command: 'record', category: 'capability-gated', status: 'planned' },
  { command: 'trace', category: 'capability-gated', status: 'planned' },
  { command: 'replay', category: 'capability-gated', status: 'planned' },
  { command: 'test', category: 'capability-gated', status: 'planned' },
  { command: 'batch', category: 'capability-gated', status: 'planned' },
  { command: 'logs', category: 'capability-gated', status: 'planned' },
  { command: 'network', category: 'capability-gated', status: 'planned' },
  { command: 'perf', category: 'capability-gated', status: 'planned' },
];
