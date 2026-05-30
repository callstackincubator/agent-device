import { describe, expect, test } from 'vitest';
import { recordCliOutput } from '../client-output.ts';

describe('recordCliOutput', () => {
  test('prints chunked Android recording paths clearly for human stdout', () => {
    const output = recordCliOutput({
      recording: 'stopped',
      outPath: '/tmp/recording.mp4',
      telemetryPath: '/tmp/recording.gesture-telemetry.json',
      warning:
        'Android adb screenrecord is capped at 180s, so this recording was split into multiple MP4 chunks.',
      overlayWarning:
        'touch overlay burn-in is skipped for chunked Android recordings; returning raw chunks plus gesture telemetry',
      chunks: [
        { index: 1, path: '/tmp/recording.mp4' },
        { index: 2, path: '/tmp/recording.part-002.mp4' },
      ],
    });

    expect(output.text).toBe(
      [
        'Recording chunks:',
        '  1: /tmp/recording.mp4',
        '  2: /tmp/recording.part-002.mp4',
        'Telemetry: /tmp/recording.gesture-telemetry.json',
        'Warning: Android adb screenrecord is capped at 180s, so this recording was split into multiple MP4 chunks.',
        'Overlay warning: touch overlay burn-in is skipped for chunked Android recordings; returning raw chunks plus gesture telemetry',
      ].join('\n'),
    );
    expect(output.data).toMatchObject({
      chunks: [
        { index: 1, path: '/tmp/recording.mp4' },
        { index: 2, path: '/tmp/recording.part-002.mp4' },
      ],
    });
  });
});
