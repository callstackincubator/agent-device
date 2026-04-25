export const METRO_COMPANION_RUN_ARG = '--agent-device-run-metro-companion';
export const REACT_DEVTOOLS_COMPANION_RUN_ARG = '--agent-device-run-react-devtools-companion';
export const METRO_COMPANION_RECONNECT_DELAY_MS = 1_000;
export const METRO_COMPANION_LEASE_CHECK_INTERVAL_MS = 250;
export const WS_READY_STATE_OPEN = 1;

export const ENV_SERVER_BASE_URL = 'AGENT_DEVICE_METRO_COMPANION_SERVER_BASE_URL';
export const ENV_BEARER_TOKEN = 'AGENT_DEVICE_METRO_COMPANION_BEARER_TOKEN';
export const ENV_LOCAL_BASE_URL = 'AGENT_DEVICE_METRO_COMPANION_LOCAL_BASE_URL';
export const ENV_LAUNCH_URL = 'AGENT_DEVICE_METRO_COMPANION_LAUNCH_URL';
export const ENV_STATE_PATH = 'AGENT_DEVICE_METRO_COMPANION_STATE_PATH';
export const ENV_SCOPE_TENANT_ID = 'AGENT_DEVICE_METRO_COMPANION_SCOPE_TENANT_ID';
export const ENV_SCOPE_RUN_ID = 'AGENT_DEVICE_METRO_COMPANION_SCOPE_RUN_ID';
export const ENV_SCOPE_LEASE_ID = 'AGENT_DEVICE_METRO_COMPANION_SCOPE_LEASE_ID';
export const ENV_REGISTER_PATH = 'AGENT_DEVICE_METRO_COMPANION_REGISTER_PATH';
export const ENV_UNREGISTER_PATH = 'AGENT_DEVICE_METRO_COMPANION_UNREGISTER_PATH';
export const ENV_DEVICE_PORT = 'AGENT_DEVICE_METRO_COMPANION_DEVICE_PORT';
export const ENV_SESSION = 'AGENT_DEVICE_METRO_COMPANION_SESSION';

export type MetroBridgeScope = {
  tenantId: string;
  runId: string;
  leaseId: string;
};

export type CompanionOptions = {
  serverBaseUrl: string;
  bearerToken: string;
  localBaseUrl: string;
  bridgeScope: MetroBridgeScope;
  launchUrl?: string;
  statePath?: string;
  registerPath?: string;
  unregisterPath?: string;
  devicePort?: number;
  session?: string;
};
