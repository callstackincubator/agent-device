import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { AppError, normalizeError } from '../../utils/errors.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import {
  appendAppLogMarker,
  clearAppLogFiles,
  getAppLogPathMetadata,
  readSessionNetworkCapture,
  runAppLogDoctor,
  startAppLog,
  stopAppLog,
} from '../app-log.ts';
import { buildPerfResponseData } from './session-perf.ts';

const LOG_ACTIONS = ['path', 'start', 'stop', 'doctor', 'mark', 'clear'] as const;
const LOG_ACTIONS_MESSAGE = `logs requires ${LOG_ACTIONS.slice(0, -1).join(', ')}, or ${LOG_ACTIONS.at(-1)}`;
const NETWORK_ACTIONS = ['dump', 'log'] as const;
const NETWORK_ACTIONS_MESSAGE = `network requires ${NETWORK_ACTIONS.join(' or ')}`;
const NETWORK_INCLUDE_MODES = ['summary', 'headers', 'body', 'all'] as const;
const NETWORK_INCLUDE_MESSAGE = `network include mode must be one of: ${NETWORK_INCLUDE_MODES.join(', ')}`;

type NetworkIncludeMode = (typeof NETWORK_INCLUDE_MODES)[number];

type ObservabilityParams = {
  req: DaemonRequest;
  sessionName: string;
  sessionStore: SessionStore;
};

export function resolveSessionLogBackendLabel(
  session: SessionState,
): 'ios-simulator' | 'ios-device' | 'android' | 'macos' {
  if (session.appLog) {
    return session.appLog.backend;
  }
  if (session.device.platform === 'macos') {
    return 'macos';
  }
  if (session.device.platform === 'ios') {
    return session.device.kind === 'device' ? 'ios-device' : 'ios-simulator';
  }
  return 'android';
}

export async function handleSessionObservabilityCommands(
  params: ObservabilityParams,
): Promise<DaemonResponse | null> {
  const { req } = params;

  if (req.command === 'perf') {
    return handlePerfCommand(params);
  }
  if (req.command === 'logs') {
    return handleLogsCommand(params);
  }
  if (req.command === 'network') {
    return handleNetworkCommand(params);
  }

  return null;
}

// ---------------------------------------------------------------------------
// perf
// ---------------------------------------------------------------------------

function handlePerfCommand(params: ObservabilityParams): DaemonResponse | null {
  const { sessionName, sessionStore } = params;
  const session = sessionStore.get(sessionName);
  if (!session) {
    return {
      ok: false,
      error: {
        code: 'SESSION_NOT_FOUND',
        message: 'perf requires an active session. Run open first.',
      },
    };
  }
  return { ok: true, data: buildPerfResponseData(session) };
}

// ---------------------------------------------------------------------------
// logs
// ---------------------------------------------------------------------------

async function handleLogsCommand(params: ObservabilityParams): Promise<DaemonResponse> {
  const { req, sessionName, sessionStore } = params;
  const session = sessionStore.get(sessionName);
  if (!session) {
    return {
      ok: false,
      error: { code: 'SESSION_NOT_FOUND', message: 'logs requires an active session' },
    };
  }
  if (!isCommandSupportedOnDevice('logs', session.device)) {
    return {
      ok: false,
      error: normalizeError(
        new AppError('UNSUPPORTED_OPERATION', 'logs is not supported on this device'),
      ),
    };
  }

  const action = (req.positionals?.[0] ?? 'path').toLowerCase();
  const restart = Boolean(req.flags?.restart);
  if (!LOG_ACTIONS.includes(action as (typeof LOG_ACTIONS)[number])) {
    return { ok: false, error: { code: 'INVALID_ARGS', message: LOG_ACTIONS_MESSAGE } };
  }
  if (restart && action !== 'clear') {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: 'logs --restart is only supported with logs clear',
      },
    };
  }

  if (action === 'path') {
    return handleLogsPath(session, sessionName, sessionStore);
  }
  if (action === 'doctor') {
    return handleLogsDoctor(session, sessionName, sessionStore);
  }
  if (action === 'mark') {
    return handleLogsMark(req, sessionName, sessionStore);
  }
  if (action === 'clear') {
    return handleLogsClear(session, sessionName, sessionStore, restart);
  }
  if (action === 'start') {
    return handleLogsStart(session, sessionName, sessionStore);
  }
  if (action === 'stop') {
    return handleLogsStop(session, sessionName, sessionStore);
  }

  return { ok: false, error: { code: 'INVALID_ARGS', message: LOG_ACTIONS_MESSAGE } };
}

function handleLogsPath(
  session: SessionState,
  sessionName: string,
  sessionStore: SessionStore,
): DaemonResponse {
  const logPath = sessionStore.resolveAppLogPath(sessionName);
  const metadata = getAppLogPathMetadata(logPath);
  return {
    ok: true,
    data: {
      path: logPath,
      active: Boolean(session.appLog),
      state: session.appLog?.getState() ?? 'inactive',
      backend: resolveSessionLogBackendLabel(session),
      sizeBytes: metadata.sizeBytes,
      modifiedAt: metadata.modifiedAt,
      startedAt: session.appLog?.startedAt
        ? new Date(session.appLog.startedAt).toISOString()
        : undefined,
      hint: 'Grep the file for token-efficient debugging, e.g. grep -n "Error\\|Exception" <path>',
    },
  };
}

async function handleLogsDoctor(
  session: SessionState,
  sessionName: string,
  sessionStore: SessionStore,
): Promise<DaemonResponse> {
  const logPath = sessionStore.resolveAppLogPath(sessionName);
  const doctor = await runAppLogDoctor(session.device, session.appBundleId);
  return {
    ok: true,
    data: {
      path: logPath,
      active: Boolean(session.appLog),
      state: session.appLog?.getState() ?? 'inactive',
      checks: doctor.checks,
      notes: doctor.notes,
    },
  };
}

function handleLogsMark(
  req: DaemonRequest,
  sessionName: string,
  sessionStore: SessionStore,
): DaemonResponse {
  const marker = req.positionals?.slice(1).join(' ') ?? '';
  const logPath = sessionStore.resolveAppLogPath(sessionName);
  appendAppLogMarker(logPath, marker);
  return { ok: true, data: { path: logPath, marked: true } };
}

async function handleLogsClear(
  session: SessionState,
  sessionName: string,
  sessionStore: SessionStore,
  restart: boolean,
): Promise<DaemonResponse> {
  if (session.appLog && !restart) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: 'logs clear requires logs to be stopped first; run logs stop',
      },
    };
  }
  if (restart && !session.appBundleId) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: 'logs clear --restart requires an app session; run open <app> first',
      },
    };
  }

  const logPath = sessionStore.resolveAppLogPath(sessionName);
  if (!restart) {
    return { ok: true, data: clearAppLogFiles(logPath) };
  }

  if (session.appLog) {
    await stopAppLog(session.appLog);
  }
  const cleared = clearAppLogFiles(logPath);
  const appLogPidPath = sessionStore.resolveAppLogPidPath(sessionName);
  try {
    const appLogStream = await startAppLog(
      session.device,
      session.appBundleId as string,
      logPath,
      appLogPidPath,
    );
    sessionStore.set(sessionName, {
      ...session,
      appLog: {
        platform: session.device.platform,
        backend: appLogStream.backend,
        outPath: logPath,
        startedAt: appLogStream.startedAt,
        getState: appLogStream.getState,
        stop: appLogStream.stop,
        wait: appLogStream.wait,
      },
    });
    return { ok: true, data: { ...cleared, restarted: true } };
  } catch (err) {
    sessionStore.set(sessionName, { ...session, appLog: undefined });
    return { ok: false, error: normalizeError(err) };
  }
}

async function handleLogsStart(
  session: SessionState,
  sessionName: string,
  sessionStore: SessionStore,
): Promise<DaemonResponse> {
  if (session.appLog) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: 'app log already streaming; run logs stop first',
      },
    };
  }
  if (!session.appBundleId) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: 'logs start requires an app session; run open <app> first',
      },
    };
  }

  const appLogPath = sessionStore.resolveAppLogPath(sessionName);
  const appLogPidPath = sessionStore.resolveAppLogPidPath(sessionName);
  try {
    const appLogStream = await startAppLog(
      session.device,
      session.appBundleId,
      appLogPath,
      appLogPidPath,
    );
    sessionStore.set(sessionName, {
      ...session,
      appLog: {
        platform: session.device.platform,
        backend: appLogStream.backend,
        outPath: appLogPath,
        startedAt: appLogStream.startedAt,
        getState: appLogStream.getState,
        stop: appLogStream.stop,
        wait: appLogStream.wait,
      },
    });
    return { ok: true, data: { path: appLogPath, started: true } };
  } catch (err) {
    return { ok: false, error: normalizeError(err) };
  }
}

async function handleLogsStop(
  session: SessionState,
  sessionName: string,
  sessionStore: SessionStore,
): Promise<DaemonResponse> {
  if (!session.appLog) {
    return { ok: false, error: { code: 'INVALID_ARGS', message: 'no app log stream active' } };
  }
  const outPath = session.appLog.outPath;
  await stopAppLog(session.appLog);
  sessionStore.set(sessionName, { ...session, appLog: undefined });
  return { ok: true, data: { path: outPath, stopped: true } };
}

// ---------------------------------------------------------------------------
// network
// ---------------------------------------------------------------------------

async function handleNetworkCommand(params: ObservabilityParams): Promise<DaemonResponse> {
  const { req, sessionName, sessionStore } = params;
  const session = sessionStore.get(sessionName);
  if (!session) {
    return {
      ok: false,
      error: { code: 'SESSION_NOT_FOUND', message: 'network requires an active session' },
    };
  }
  if (!isCommandSupportedOnDevice('network', session.device)) {
    return {
      ok: false,
      error: normalizeError(
        new AppError('UNSUPPORTED_OPERATION', 'network is not supported on this device'),
      ),
    };
  }

  const action = (req.positionals?.[0] ?? 'dump').toLowerCase();
  if (!NETWORK_ACTIONS.includes(action as (typeof NETWORK_ACTIONS)[number])) {
    return { ok: false, error: { code: 'INVALID_ARGS', message: NETWORK_ACTIONS_MESSAGE } };
  }

  const maxEntries = req.positionals?.[1] ? Number.parseInt(req.positionals[1], 10) : 25;
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 200) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: 'network dump limit must be an integer in range 1..200',
      },
    };
  }

  const includeValidation = resolveNetworkIncludeMode(req);
  if (!includeValidation.ok) return includeValidation.response;
  const { include } = includeValidation;

  const capture = await readSessionNetworkCapture({
    device: session.device,
    appBundleId: session.appBundleId,
    appLogState: session.appLog?.getState(),
    appLogPath: sessionStore.resolveAppLogPath(sessionName),
    maxEntries,
    include,
    maxPayloadChars: 2048,
    maxScanLines: 4000,
  });

  return {
    ok: true,
    data: {
      ...capture.dump,
      active: Boolean(session.appLog),
      state: session.appLog?.getState() ?? 'inactive',
      backend: capture.backend,
      notes: capture.notes,
    },
  };
}

function resolveNetworkIncludeMode(
  req: DaemonRequest,
): { ok: true; include: NetworkIncludeMode } | { ok: false; response: DaemonResponse } {
  const positionalInclude = req.positionals?.[2]?.toLowerCase();
  const flagInclude = req.flags?.networkInclude;
  if (positionalInclude && flagInclude && positionalInclude !== flagInclude) {
    return {
      ok: false,
      response: {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message:
            'network include mode was provided both positionally and via --include with different values',
        },
      },
    };
  }
  const requestedInclude = (flagInclude ?? positionalInclude ?? 'summary').toLowerCase();
  if (
    !NETWORK_INCLUDE_MODES.includes(requestedInclude as (typeof NETWORK_INCLUDE_MODES)[number])
  ) {
    return {
      ok: false,
      response: { ok: false, error: { code: 'INVALID_ARGS', message: NETWORK_INCLUDE_MESSAGE } },
    };
  }
  return { ok: true, include: requestedInclude as NetworkIncludeMode };
}
