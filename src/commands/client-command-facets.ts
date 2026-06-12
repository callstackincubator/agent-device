import { debuggingCommandDefinitions, debuggingCommandMetadata } from './debugging/index.ts';
import { captureCommandDefinitions, captureCommandMetadata } from './capture/index.ts';
import { managementCommandDefinitions, managementCommandMetadata } from './management/index.ts';
import { metroCommandDefinition, metroCommandMetadata } from './metro/index.ts';
import {
  observabilityCommandDefinitions,
  observabilityCommandMetadata,
} from './observability/index.ts';
import { perfCommandDefinitions, perfCommandMetadataList } from './perf/index.ts';
import { reactNativeCommandDefinition, reactNativeCommandMetadata } from './react-native/index.ts';
import { recordingCommandDefinitions, recordingCommandMetadata } from './recording/index.ts';
import { replayCommandDefinitions, replayCommandMetadataList } from './replay/index.ts';
import { systemCommandDefinitions, systemCommandMetadata } from './system/index.ts';

const clientCommandFamilyFacets = [
  {
    metadata: managementCommandMetadata,
    definitions: managementCommandDefinitions,
  },
  {
    metadata: captureCommandMetadata,
    definitions: captureCommandDefinitions,
  },
  {
    metadata: systemCommandMetadata,
    definitions: systemCommandDefinitions,
  },
  {
    metadata: [reactNativeCommandMetadata],
    definitions: [reactNativeCommandDefinition],
  },
  {
    metadata: replayCommandMetadataList,
    definitions: replayCommandDefinitions,
  },
  {
    metadata: observabilityCommandMetadata,
    definitions: observabilityCommandDefinitions,
  },
  {
    metadata: perfCommandMetadataList,
    definitions: perfCommandDefinitions,
  },
  {
    metadata: debuggingCommandMetadata,
    definitions: debuggingCommandDefinitions,
  },
  {
    metadata: recordingCommandMetadata,
    definitions: recordingCommandDefinitions,
  },
  {
    metadata: [metroCommandMetadata],
    definitions: [metroCommandDefinition],
  },
] as const;

export const clientCommandMetadata = readClientCommandMetadata(clientCommandFamilyFacets);

export const clientCommandDefinitions = readClientCommandDefinitions(clientCommandFamilyFacets);

function readClientCommandMetadata<
  const TFacets extends readonly { metadata: readonly unknown[] }[],
>(facets: TFacets): Array<TFacets[number]['metadata'][number]> {
  return facets.flatMap((family) => [...family.metadata]) as Array<
    TFacets[number]['metadata'][number]
  >;
}

function readClientCommandDefinitions<
  const TFacets extends readonly { definitions: readonly unknown[] }[],
>(facets: TFacets): Array<TFacets[number]['definitions'][number]> {
  return facets.flatMap((family) => [...family.definitions]) as Array<
    TFacets[number]['definitions'][number]
  >;
}
