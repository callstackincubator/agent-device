import { defineStringEnum } from '../utils/string-enum.ts';

export const PERF_AREA_VALUES = ['metrics', 'frames'] as const;
export const PERF_ACTION_VALUES = ['sample'] as const;
const PERF_AREAS = defineStringEnum(PERF_AREA_VALUES);
const PERF_ACTIONS = defineStringEnum(PERF_ACTION_VALUES);

export type PerfArea = (typeof PERF_AREA_VALUES)[number];
export type PerfAction = (typeof PERF_ACTION_VALUES)[number];

export const PERF_AREA_ERROR_MESSAGE = 'perf area must be metrics or frames';
export const PERF_ACTION_ERROR_MESSAGE = 'perf action must be sample';

export const isPerfArea = PERF_AREAS.is;

export const isPerfAction = PERF_ACTIONS.is;
