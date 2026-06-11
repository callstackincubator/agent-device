import { batchCommandDescriptions } from './batch/index.ts';
import { captureCommandDescriptions } from './capture/index.ts';
import { interactionCommandDescriptions } from './interaction/index.ts';
import { managementCommandDescriptions } from './management/index.ts';
import { metroCommandDescriptions } from './metro/index.ts';
import { observabilityCommandDescriptions } from './observability/index.ts';
import { reactNativeCommandDescriptions } from './react-native/index.ts';
import { recordingCommandDescriptions } from './recording/index.ts';
import { replayCommandDescriptions } from './replay/index.ts';
import { systemCommandDescriptions } from './system/index.ts';

const COMMAND_DESCRIPTIONS = {
  ...managementCommandDescriptions,
  ...captureCommandDescriptions,
  ...interactionCommandDescriptions,
  ...systemCommandDescriptions,
  ...reactNativeCommandDescriptions,
  ...replayCommandDescriptions,
  ...observabilityCommandDescriptions,
  ...recordingCommandDescriptions,
  ...metroCommandDescriptions,
  ...batchCommandDescriptions,
} as const;

export type DescribedCommandName = keyof typeof COMMAND_DESCRIPTIONS;

export function listCommandDescriptionMetadata(): Array<{
  name: DescribedCommandName;
  description: string;
}> {
  return Object.entries(COMMAND_DESCRIPTIONS).map(([name, description]) => ({
    name: name as DescribedCommandName,
    description,
  }));
}
