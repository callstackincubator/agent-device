import { PUBLIC_COMMANDS } from '../../command-catalog.ts';
import { commandCapabilityMap, commandSchemaMap, defineCommand } from '../command-definition.ts';

export type ReactNativeCommandOptions = {
  action: 'dismiss-overlay';
};

const reactNativeCommandDefinition = defineCommand({
  name: PUBLIC_COMMANDS.reactNative,
  schema: {
    usageOverride: 'react-native dismiss-overlay',
    listUsageOverride: 'react-native dismiss-overlay',
    helpDescription: 'Dismiss React Native LogBox/RedBox overlays safely',
    summary: 'Dismiss React Native overlays',
    positionalArgs: ['dismiss-overlay'],
    allowedFlags: [],
  },
  capability: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: {},
  },
});

const REACT_NATIVE_COMMAND_DEFINITIONS = [reactNativeCommandDefinition] as const;

export const REACT_NATIVE_COMMAND_SCHEMAS = commandSchemaMap(REACT_NATIVE_COMMAND_DEFINITIONS);
export const REACT_NATIVE_COMMAND_CAPABILITIES = commandCapabilityMap(
  REACT_NATIVE_COMMAND_DEFINITIONS,
);
