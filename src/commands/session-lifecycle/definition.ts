import { PUBLIC_COMMANDS } from '../../command-catalog.ts';
import type { CommandCapability } from '../../core/capabilities.ts';
import { commandCapabilityMap, commandSchemaMap, defineCommand } from '../command-definition.ts';

const APP_RUNTIME_CAPABILITY = {
  apple: { simulator: true, device: true },
  android: { emulator: true, device: true, unknown: true },
  linux: { device: true },
} as const satisfies CommandCapability;

const APP_INVENTORY_CAPABILITY = {
  apple: { simulator: true, device: true },
  android: { emulator: true, device: true, unknown: true },
  linux: {},
} as const satisfies CommandCapability;

const APP_INSTALL_CAPABILITY = {
  apple: { simulator: true, device: true },
  android: { emulator: true, device: true, unknown: true },
  linux: {},
  supports: (device) => device.platform !== 'macos',
} as const satisfies CommandCapability;

const openCommandDefinition = defineCommand({
  name: PUBLIC_COMMANDS.open,
  schema: {
    helpDescription:
      'Boot device/simulator; optionally launch app or deep link URL (macOS also supports --surface app|frontmost-app|desktop|menubar)',
    summary: 'Open an app, deep link or URL, save replays',
    positionalArgs: ['appOrUrl?', 'url?'],
    allowedFlags: ['activity', 'saveScript', 'relaunch', 'surface'],
  },
  capability: APP_RUNTIME_CAPABILITY,
});

const closeCommandDefinition = defineCommand({
  name: PUBLIC_COMMANDS.close,
  schema: {
    helpDescription: 'Close app or just end session',
    summary: 'Close app or end session',
    positionalArgs: ['app?'],
    allowedFlags: ['saveScript', 'shutdown'],
  },
  capability: APP_RUNTIME_CAPABILITY,
});

const reinstallCommandDefinition = defineCommand({
  name: PUBLIC_COMMANDS.reinstall,
  schema: {
    helpDescription: 'Uninstall + install app from binary path',
    summary: 'Reinstall app from binary path',
    positionalArgs: ['app', 'path'],
    allowedFlags: [],
  },
  capability: APP_INSTALL_CAPABILITY,
});

const installCommandDefinition = defineCommand({
  name: PUBLIC_COMMANDS.install,
  schema: {
    helpDescription: 'Install app from binary path without uninstalling first',
    summary: 'Install app from binary path',
    positionalArgs: ['app', 'path'],
    allowedFlags: [],
  },
  capability: APP_INSTALL_CAPABILITY,
});

const installFromSourceCommandDefinition = defineCommand({
  name: PUBLIC_COMMANDS.installFromSource,
  schema: {
    usageOverride:
      'install-from-source <url> | install-from-source --github-actions-artifact <owner/repo:artifact>',
    listUsageOverride: 'install-from-source <url> | install-from-source --github-actions-artifact',
    helpDescription: 'Install app from a URL or remote-resolved source',
    summary: 'Install app from a source',
    positionalArgs: ['url?'],
    allowedFlags: [
      'header',
      'githubActionsArtifact',
      'installSource',
      'retainPaths',
      'retentionMs',
    ],
  },
  capability: APP_INSTALL_CAPABILITY,
});

const appsCommandDefinition = defineCommand({
  name: PUBLIC_COMMANDS.apps,
  schema: {
    helpDescription: 'List installed apps (includes default/system apps by default)',
    summary: 'List installed apps',
    positionalArgs: [],
    allowedFlags: ['appsFilter'],
    defaults: { appsFilter: 'all' },
  },
  capability: APP_INVENTORY_CAPABILITY,
});

export const SESSION_LIFECYCLE_COMMAND_DEFINITIONS = [
  openCommandDefinition,
  closeCommandDefinition,
  reinstallCommandDefinition,
  installCommandDefinition,
  installFromSourceCommandDefinition,
  appsCommandDefinition,
] as const;

export const SESSION_LIFECYCLE_COMMAND_SCHEMAS = commandSchemaMap(
  SESSION_LIFECYCLE_COMMAND_DEFINITIONS,
);

export const SESSION_LIFECYCLE_COMMAND_CAPABILITIES = commandCapabilityMap(
  SESSION_LIFECYCLE_COMMAND_DEFINITIONS,
);
