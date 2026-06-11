import { captureCommandMetadata } from './capture/index.ts';
import { managementCommandMetadata } from './management/index.ts';
import { metroCommandMetadata } from './metro/index.ts';
import { observabilityCommandMetadata } from './observability/index.ts';
import { reactNativeCommandMetadata } from './react-native/index.ts';
import { recordingCommandMetadata } from './recording/index.ts';
import { replayCommandMetadataList } from './replay/index.ts';
import { systemCommandMetadata } from './system/index.ts';

export const clientCommandMetadata = [
  ...managementCommandMetadata,
  ...captureCommandMetadata,
  ...systemCommandMetadata,
  reactNativeCommandMetadata,
  ...replayCommandMetadataList,
  ...observabilityCommandMetadata,
  ...recordingCommandMetadata,
  metroCommandMetadata,
] as const;
