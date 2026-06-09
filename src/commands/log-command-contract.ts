export const LOG_ACTION_VALUES = ['path', 'start', 'stop', 'doctor', 'mark', 'clear'] as const;
export type LogAction = (typeof LOG_ACTION_VALUES)[number];
