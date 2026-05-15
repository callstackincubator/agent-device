import { PUBLIC_COMMANDS } from '../command-catalog.ts';
import {
  ALL_DEVICE_COMMAND_CAPABILITY,
  commandCapabilityMap,
  commandSchemaMap,
  defineCommand,
} from './command-definition.ts';
import { SCREENSHOT_COMMAND_FLAG_KEYS } from './capture-screenshot-options.ts';

const SNAPSHOT_FLAGS = [
  'snapshotInteractiveOnly',
  'snapshotCompact',
  'snapshotDepth',
  'snapshotScope',
  'snapshotRaw',
] as const;

const snapshotCommandDefinition = defineCommand({
  name: PUBLIC_COMMANDS.snapshot,
  schema: {
    usageOverride: 'snapshot [--diff] [-i] [-c] [-d <depth>] [-s <scope>] [--raw] [--force-full]',
    helpDescription: 'Capture accessibility tree or diff against the previous session baseline',
    positionalArgs: [],
    allowedFlags: ['snapshotDiff', ...SNAPSHOT_FLAGS, 'snapshotForceFull'],
  },
  capability: ALL_DEVICE_COMMAND_CAPABILITY,
});

const diffCommandDefinition = defineCommand({
  name: PUBLIC_COMMANDS.diff,
  schema: {
    usageOverride:
      'diff snapshot | diff screenshot --baseline <path> [current.png] [--out <diff.png>] [--threshold <0-1>] [--overlay-refs]',
    helpDescription: 'Diff accessibility snapshot or compare screenshots pixel-by-pixel',
    summary: 'Diff snapshot or screenshot',
    positionalArgs: ['kind', 'current?'],
    allowedFlags: [...SNAPSHOT_FLAGS, 'baseline', 'threshold', 'out', 'overlayRefs'],
  },
  capability: ALL_DEVICE_COMMAND_CAPABILITY,
});

const screenshotCommandDefinition = defineCommand({
  name: PUBLIC_COMMANDS.screenshot,
  schema: {
    helpDescription:
      'Capture screenshot (macOS app sessions default to the app window; use --fullscreen for full desktop, --max-size to downscale, --overlay-refs to annotate current refs, or --no-stabilize for low-latency Android capture loops)',
    positionalArgs: ['path?'],
    allowedFlags: SCREENSHOT_COMMAND_FLAG_KEYS,
  },
  capability: ALL_DEVICE_COMMAND_CAPABILITY,
});

export const CAPTURE_COMMAND_DEFINITIONS = [
  snapshotCommandDefinition,
  diffCommandDefinition,
  screenshotCommandDefinition,
] as const;

export const CAPTURE_COMMAND_SCHEMAS = commandSchemaMap(CAPTURE_COMMAND_DEFINITIONS);
export const CAPTURE_COMMAND_CAPABILITIES = commandCapabilityMap(CAPTURE_COMMAND_DEFINITIONS);
