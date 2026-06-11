import { captureCommandDefinitions } from './capture/index.ts';
import { managementCommandDefinitions } from './management/index.ts';
import { metroCommandDefinition } from './metro/index.ts';
import { observabilityCommandDefinitions } from './observability/index.ts';
import { reactNativeCommandDefinition } from './react-native/index.ts';
import { recordingCommandDefinitions } from './recording/index.ts';
import { replayCommandDefinitions } from './replay/index.ts';
import { systemCommandDefinitions } from './system/index.ts';

export const clientCommandDefinitions = [
  ...managementCommandDefinitions,
  ...captureCommandDefinitions,
  ...systemCommandDefinitions,
  reactNativeCommandDefinition,
  ...replayCommandDefinitions,
  ...observabilityCommandDefinitions,
  ...recordingCommandDefinitions,
  metroCommandDefinition,
] as const;
