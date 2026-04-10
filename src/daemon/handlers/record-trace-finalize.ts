import { persistRecordingTelemetry } from '../recording-telemetry.ts';
import { getRecordingOverlaySupportWarning } from '../../recording/overlay.ts';
import { formatRecordTraceError } from '../record-trace-errors.ts';
import type { RecordTraceDeps } from './record-trace-recording.ts';

type FinalizeRecordingOverlayParams = {
  recording: {
    outPath: string;
    gestureEvents: import('../types.ts').RecordingGestureEvent[];
    telemetryPath?: string;
    showTouches: boolean;
    overlayWarning?: string;
  };
  deps: Pick<RecordTraceDeps, 'overlayRecordingTouches'>;
  trimStartMs?: number;
  targetLabel: string;
};

export async function finalizeRecordingOverlay(
  params: FinalizeRecordingOverlayParams,
): Promise<void> {
  const { recording, deps, trimStartMs, targetLabel } = params;

  const telemetryPath = persistRecordingTelemetry({
    recording,
    trimStartMs,
  });

  if (recording.showTouches) {
    const overlaySupportWarning = getRecordingOverlaySupportWarning();
    if (overlaySupportWarning) {
      recording.overlayWarning = overlaySupportWarning;
    } else {
      try {
        await deps.overlayRecordingTouches({
          videoPath: recording.outPath,
          telemetryPath,
          targetLabel,
        });
      } catch (error) {
        recording.overlayWarning = `failed to overlay recording touches: ${formatRecordTraceError(error)}`;
      }
    }
  }
}
