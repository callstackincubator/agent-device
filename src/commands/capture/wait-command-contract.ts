export const WAIT_KIND_VALUES = ['duration', 'text', 'ref', 'selector'] as const;
export type WaitKind = (typeof WAIT_KIND_VALUES)[number];
