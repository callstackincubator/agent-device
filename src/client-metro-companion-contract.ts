export const METRO_COMPANION_RUN_ARG = '--agent-device-run-metro-companion';
export const METRO_COMPANION_RECONNECT_DELAY_MS = 1_000;
export const WS_READY_STATE_OPEN = 1;

export const ENV_SERVER_BASE_URL = 'AGENT_DEVICE_METRO_COMPANION_SERVER_BASE_URL';
export const ENV_BEARER_TOKEN = 'AGENT_DEVICE_METRO_COMPANION_BEARER_TOKEN';
export const ENV_LOCAL_BASE_URL = 'AGENT_DEVICE_METRO_COMPANION_LOCAL_BASE_URL';
export const ENV_LAUNCH_URL = 'AGENT_DEVICE_METRO_COMPANION_LAUNCH_URL';

export type MetroCompanionRequest =
  | { type: 'ping'; timestamp: number }
  | {
      type: 'http-request';
      requestId: string;
      method: string;
      path: string;
      headers?: Record<string, string>;
      bodyBase64?: string;
    }
  | {
      type: 'ws-open';
      streamId: string;
      path: string;
      headers?: Record<string, string>;
    }
  | {
      type: 'ws-frame';
      streamId: string;
      dataBase64: string;
      binary: boolean;
    }
  | {
      type: 'ws-close';
      streamId: string;
      code?: number;
      reason?: string;
    };

export type CompanionOptions = {
  serverBaseUrl: string;
  bearerToken: string;
  localBaseUrl: string;
  launchUrl?: string;
};
