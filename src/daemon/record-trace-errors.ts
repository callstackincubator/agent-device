export function formatRecordTraceError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const MIN_PLAYABLE_RECORDING_DURATION_MS = 1_000;

type RecordingStartedAt = {
  startedAt: number;
};

type RecordStopFailure = {
  message: string;
  tooShort: boolean;
};

export function formatRecordTraceExecFailure(
  result: { stdout: string; stderr: string; exitCode: number },
  command: string,
): string {
  return (
    result.stderr.trim() || result.stdout.trim() || `${command} exited with code ${result.exitCode}`
  );
}

export function buildRecordStopFailure(
  message: string,
  recording: RecordingStartedAt,
  now = Date.now(),
): RecordStopFailure {
  const elapsedMs = Math.max(0, now - recording.startedAt);
  if (elapsedMs >= MIN_PLAYABLE_RECORDING_DURATION_MS) {
    return { message, tooShort: false };
  }
  return {
    message: `${message}. Recording stopped after ${Math.round(elapsedMs)}ms; wait at least ${MIN_PLAYABLE_RECORDING_DURATION_MS}ms between record start and record stop so the recorder can finalize a playable MP4`,
    tooShort: true,
  };
}
