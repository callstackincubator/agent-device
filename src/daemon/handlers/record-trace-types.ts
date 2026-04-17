import type { runCmd, runCmdBackground } from '../../utils/exec.ts';
import type { isPlayableVideo, waitForStableFile } from '../../utils/video.ts';
import type { runIosRunnerCommand } from '../../platforms/ios/runner-client.ts';
import type {
  overlayRecordingTouches,
  resizeRecording,
  trimRecordingStart,
} from '../../recording/overlay.ts';
import type { RecordingGestureEvent } from '../types.ts';

export type RecordTraceDeps = {
  runCmd: typeof runCmd;
  runCmdBackground: typeof runCmdBackground;
  runIosRunnerCommand: typeof runIosRunnerCommand;
  waitForStableFile: typeof waitForStableFile;
  isPlayableVideo: typeof isPlayableVideo;
  trimRecordingStart: typeof trimRecordingStart;
  resizeRecording: typeof resizeRecording;
  overlayRecordingTouches: typeof overlayRecordingTouches;
};

export type RecordingBase = {
  outPath: string;
  clientOutPath?: string;
  startedAt: number;
  quality?: number;
  showTouches: boolean;
  gestureEvents: RecordingGestureEvent[];
};
