import type { ExecResult, ExecBackgroundResult } from '../../utils/exec.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import type { RunnerXctestrunArtifact } from './runner-xctestrun.ts';
import type { RunnerLease } from './runner-lease.ts';

export type RunnerSession = {
  sessionId: string;
  device: DeviceInfo;
  deviceId: string;
  port: number;
  xctestrunPath: string;
  xctestrunArtifact?: RunnerXctestrunArtifact;
  jsonPath: string;
  testPromise: Promise<ExecResult>;
  child: ExecBackgroundResult['child'];
  ready: boolean;
  startupTimeoutMs?: number;
  startupTimings?: Record<string, number>;
  startupTimingsReported?: boolean;
  simulatorSetRedirect?: { release: () => Promise<void> };
  lease?: RunnerLease;
};
