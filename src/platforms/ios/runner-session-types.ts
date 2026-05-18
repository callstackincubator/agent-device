import type { ExecResult, ExecBackgroundResult } from '../../utils/exec.ts';
import type { DeviceInfo } from '../../utils/device.ts';

export type RunnerSession = {
  sessionId: string;
  device: DeviceInfo;
  deviceId: string;
  port: number;
  xctestrunPath: string;
  jsonPath: string;
  testPromise: Promise<ExecResult>;
  child: ExecBackgroundResult['child'];
  ready: boolean;
  startupTimings?: Record<string, number>;
  startupTimingsReported?: boolean;
  simulatorSetRedirect?: { release: () => Promise<void> };
};
