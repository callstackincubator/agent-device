export const PERF_AREA_VALUES = ['metrics', 'frames'] as const;
export const PERF_ACTION_VALUES = ['sample'] as const;

export type PerfArea = (typeof PERF_AREA_VALUES)[number];
export type PerfAction = (typeof PERF_ACTION_VALUES)[number];

export const PERF_AREA_ERROR_MESSAGE = 'perf area must be metrics or frames';
export const PERF_ACTION_ERROR_MESSAGE = 'perf action must be sample';

export function isPerfArea(value: string): value is PerfArea {
  return (PERF_AREA_VALUES as readonly string[]).includes(value);
}

export function isPerfAction(value: string): value is PerfAction {
  return (PERF_ACTION_VALUES as readonly string[]).includes(value);
}
