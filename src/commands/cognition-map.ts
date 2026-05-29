/**
 * 认知地图命令模块
 * 为AI提供应用的UI结构概览，避免盲目测试
 */

import { PUBLIC_COMMANDS } from '../command-catalog.ts';
import type { CommandCapability } from '../core/capabilities.ts';
import { commandCapabilityMap, commandSchemaMap, defineCommand } from './command-definition.ts';

const COGNITION_CAPABILITY = {
  harmonyos: { device: true },
  android: { emulator: true, device: true, unknown: true },
  apple: { simulator: true, device: true },
} as const satisfies CommandCapability;

const cognitionCommandDefinition = defineCommand({
  name: PUBLIC_COMMANDS.cognition,
  schema: {
    helpDescription:
      'Generate a cognition map of the current UI structure. AI uses this to understand the app before blind testing.',
    summary: 'Generate UI cognition map for AI planning',
    positionalArgs: [],
    allowedFlags: ['platform', 'session', 'json'],
  },
  capability: COGNITION_CAPABILITY,
});

export const COGNITION_COMMAND_DEFINITIONS = [cognitionCommandDefinition];

export const COGNITION_COMMAND_SCHEMAS = commandSchemaMap(COGNITION_COMMAND_DEFINITIONS);

export const COGNITION_COMMAND_CAPABILITIES = commandCapabilityMap(COGNITION_COMMAND_DEFINITIONS);
