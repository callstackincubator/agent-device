import fs from 'node:fs';
import path from 'node:path';
import type { RecordingGestureEvent } from './types.ts';

type RecordingTelemetryEnvelope = {
  version: 1;
  generatedAt: string;
  events: RecordingGestureEvent[];
};

export function deriveRecordingTelemetryPath(videoPath: string): string {
  const parsed = path.parse(videoPath);
  return path.join(parsed.dir, `${parsed.name}.gesture-telemetry.json`);
}

export function trimRecordingTelemetryEvents(
  events: RecordingGestureEvent[],
  trimStartMs: number,
): RecordingGestureEvent[] {
  const normalizedEvents =
    trimStartMs > 0
      ? events.flatMap((event) => {
          const adjustedStartMs = event.tMs - trimStartMs;
          const durationMs = 'durationMs' in event ? event.durationMs : undefined;
          const adjustedEndMs =
            typeof durationMs === 'number' ? adjustedStartMs + durationMs : adjustedStartMs;

          if (adjustedEndMs <= 0) {
            return [];
          }

          return [
            {
              ...event,
              tMs: Math.max(0, adjustedStartMs),
            },
          ];
        })
      : events.map((event) => ({ ...event }));

  return normalizedEvents.sort((left, right) => left.tMs - right.tMs);
}

export function writeRecordingTelemetry(params: {
  videoPath: string;
  events: RecordingGestureEvent[];
}): string {
  const telemetryPath = deriveRecordingTelemetryPath(params.videoPath);
  const payload: RecordingTelemetryEnvelope = {
    version: 1,
    generatedAt: new Date().toISOString(),
    events: trimRecordingTelemetryEvents(params.events, 0),
  };
  fs.writeFileSync(telemetryPath, JSON.stringify(payload, null, 2));
  return telemetryPath;
}
