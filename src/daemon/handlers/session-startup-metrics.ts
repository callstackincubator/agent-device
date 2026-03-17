export const STARTUP_SAMPLE_METHOD = 'open-command-roundtrip';
export const STARTUP_SAMPLE_DESCRIPTION =
  'Elapsed wall-clock time around dispatching the open command for the active session app target.';
export const PERF_STARTUP_SAMPLE_LIMIT = 20;
export const PERF_UNAVAILABLE_REASON = 'Not implemented for this platform in this release.';

export type StartupPerfSample = {
  durationMs: number;
  measuredAt: string;
  method: typeof STARTUP_SAMPLE_METHOD;
  appTarget?: string;
  appBundleId?: string;
};
