export type InteractionTimingResult = {
  gestureStartUptimeMs?: number;
  gestureEndUptimeMs?: number;
};

export function withInteractionTimingResult<T extends Record<string, unknown>>(
  payload: T,
  timing: InteractionTimingResult | void,
): T & InteractionTimingResult {
  return {
    ...payload,
    ...(timing ?? {}),
  };
}
