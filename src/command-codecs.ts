import {
  elementTargetToPositionals,
  fillOptionsToPositionals,
  interactionTargetToPositionals,
  readElementTargetFromPositionals,
  readFillTargetFromPositionals,
  readInteractionTargetFromPositionals,
  longPressOptionsToPositionals,
  readLongPressTargetFromPositionals,
} from './command-codecs/targets.ts';
import { readWaitOptionsFromPositionals, waitOptionsToPositionals } from './command-codecs/wait.ts';
import { findOptionsToPositionals, readFindOptionsFromPositionals } from './command-codecs/find.ts';
import { isOptionsToPositionals, readIsOptionsFromPositionals } from './command-codecs/is.ts';
import {
  readSettingsOptionsFromPositionals,
  settingsOptionsToPositionals,
} from './command-codecs/settings.ts';

export const interactionTargetCodec = {
  decode: readInteractionTargetFromPositionals,
  encode: interactionTargetToPositionals,
} as const;

export const elementTargetCodec = {
  decode: readElementTargetFromPositionals,
  encode: elementTargetToPositionals,
} as const;

export const fillCommandCodec = {
  decode: readFillTargetFromPositionals,
  encode: fillOptionsToPositionals,
} as const;

export const longPressCommandCodec = {
  decode: readLongPressTargetFromPositionals,
  encode: longPressOptionsToPositionals,
} as const;

export const waitCommandCodec = {
  decode: readWaitOptionsFromPositionals,
  encode: waitOptionsToPositionals,
} as const;

export const findCommandCodec = {
  decode: readFindOptionsFromPositionals,
  encode: findOptionsToPositionals,
} as const;

export const isCommandCodec = {
  decode: readIsOptionsFromPositionals,
  encode: isOptionsToPositionals,
} as const;

export const settingsCommandCodec = {
  decode: readSettingsOptionsFromPositionals,
  encode: settingsOptionsToPositionals,
} as const;
