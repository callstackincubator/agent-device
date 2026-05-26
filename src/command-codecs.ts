import {
  readElementTargetFromPositionals,
  readFillTargetFromPositionals,
  readInteractionTargetFromPositionals,
  readLongPressTargetFromPositionals,
} from './command-codecs/targets.ts';
import { readWaitOptionsFromPositionals } from './command-codecs/wait.ts';
import { readFindOptionsFromPositionals } from './command-codecs/find.ts';
import { readIsOptionsFromPositionals } from './command-codecs/is.ts';
import { readSettingsOptionsFromPositionals } from './command-codecs/settings.ts';
export { typeCommandCodec } from './command-codecs/type.ts';

export const interactionTargetCodec = {
  decode: readInteractionTargetFromPositionals,
} as const;

export const elementTargetCodec = {
  decode: readElementTargetFromPositionals,
} as const;

export const fillCommandCodec = {
  decode: readFillTargetFromPositionals,
} as const;

export const longPressCommandCodec = {
  decode: readLongPressTargetFromPositionals,
} as const;

export const waitCommandCodec = {
  decode: readWaitOptionsFromPositionals,
} as const;

export const findCommandCodec = {
  decode: readFindOptionsFromPositionals,
} as const;

export const isCommandCodec = {
  decode: readIsOptionsFromPositionals,
} as const;

export const settingsCommandCodec = {
  decode: readSettingsOptionsFromPositionals,
} as const;
