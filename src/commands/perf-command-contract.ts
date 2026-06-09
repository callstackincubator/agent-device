import { isStringMember } from '../utils/string-enum.ts';

export const PERF_AREA_VALUES = ['metrics', 'frames'] as const;
export const PERF_ACTION_VALUES = ['sample'] as const;

export type PerfArea = (typeof PERF_AREA_VALUES)[number];
export type PerfAction = (typeof PERF_ACTION_VALUES)[number];

export const PERF_AREA_ERROR_MESSAGE = 'perf area must be metrics or frames';
export const PERF_ACTION_ERROR_MESSAGE = 'perf action must be sample';

export function isPerfArea(value: string): value is PerfArea {
  return isStringMember(PERF_AREA_VALUES, value);
}

export function isPerfAction(value: string): value is PerfAction {
  return isStringMember(PERF_ACTION_VALUES, value);
}
