export const METRO_COMPANION_RUN_ARG = '--agent-device-run-metro-companion';
export const METRO_COMPANION_RECONNECT_DELAY_MS = 1_000;
export const WS_READY_STATE_OPEN = 1;

export const ENV_SERVER_BASE_URL = 'AGENT_DEVICE_METRO_COMPANION_SERVER_BASE_URL';
export const ENV_BEARER_TOKEN = 'AGENT_DEVICE_METRO_COMPANION_BEARER_TOKEN';
export const ENV_LOCAL_BASE_URL = 'AGENT_DEVICE_METRO_COMPANION_LOCAL_BASE_URL';
export const ENV_LAUNCH_URL = 'AGENT_DEVICE_METRO_COMPANION_LAUNCH_URL';
export const ENV_STATE_PATH = 'AGENT_DEVICE_METRO_COMPANION_STATE_PATH';

export type { MetroTunnelRequestMessage as MetroCompanionRequest } from './metro.ts';

export type CompanionOptions = {
  serverBaseUrl: string;
  bearerToken: string;
  localBaseUrl: string;
  launchUrl?: string;
  statePath?: string;
};
