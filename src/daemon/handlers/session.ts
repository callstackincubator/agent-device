import { dispatchCommand } from '../../core/dispatch.ts';
import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { resolvePayloadInput } from '../../utils/payload-input.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { normalizePlatformSelector } from '../../utils/device.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { contextFromFlags } from '../context.ts';
import {
  handleInstallFromSourceCommand,
  handleReleaseMaterializedPathsCommand,
} from './install-source.ts';
import { requireSessionOrExplicitSelector, resolveCommandDevice } from './session-device-utils.ts';
import { handleRuntimeCommand } from './session-runtime-command.ts';
import { handleOpenCommand } from './session-open.ts';
import {
  resolveAndroidPackageForOpen,
  resolveSessionAppBundleIdForTarget,
} from './session-open-target.ts';
import { handleCloseCommand } from './session-close.ts';
import {
  defaultInstallOps,
  defaultReinstallOps,
  handleAppDeployCommand,
} from './session-deploy.ts';
import { runBatchCommands } from './session-batch.ts';
import { handleSessionInventoryCommands } from './session-inventory.ts';
import { handleSessionStateCommands } from './session-state.ts';
import { handleSessionObservabilityCommands } from './session-observability.ts';
import { handleSessionReplayCommands } from './session-replay.ts';

const INVENTORY_COMMANDS = new Set(['session_list', 'ensure-simulator', 'devices', 'apps']);
const STATE_COMMANDS = new Set(['boot', 'appstate']);
const OBSERVABILITY_COMMANDS = new Set(['perf', 'logs', 'network']);
const REPLAY_COMMANDS = new Set(['replay', 'test']);

async function runSessionOrSelectorDispatch(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  command: string;
  positionals: string[];
  recordPositionals?: string[];
  deriveNextSession?: (
    session: SessionState,
    result: Record<string, unknown> | void,
    device: DeviceInfo,
  ) => Promise<SessionState> | SessionState;
}): Promise<DaemonResponse> {
  const {
    req,
    sessionName,
    logPath,
    sessionStore,
    command,
    positionals,
    recordPositionals,
    deriveNextSession,
  } = params;
  const session = sessionStore.get(sessionName);
  const flags = req.flags ?? {};
  const guard = requireSessionOrExplicitSelector(command, session, flags);
  if (guard) return guard;

  const device = await resolveCommandDevice({
    session,
    flags,
    ensureReady: true,
  });
  if (!isCommandSupportedOnDevice(command, device)) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: `${command} is not supported on this device`,
      },
    };
  }

  const result = await dispatchCommand(device, command, positionals, req.flags?.out, {
    ...contextFromFlags(logPath, req.flags, session?.appBundleId, session?.trace?.outPath),
  });
  if (session) {
    const nextSession = deriveNextSession
      ? await deriveNextSession(session, result, device)
      : session;
    sessionStore.recordAction(nextSession, {
      command,
      positionals: recordPositionals ?? positionals,
      flags: req.flags ?? {},
      result: result ?? {},
    });
    if (nextSession !== session) {
      sessionStore.set(sessionName, nextSession);
    }
  }
  return { ok: true, data: result ?? {} };
}

async function handleClipboardCommand(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
}): Promise<DaemonResponse> {
  const { req, sessionName, logPath, sessionStore } = params;
  const session = sessionStore.get(sessionName);
  const flags = req.flags ?? {};
  const guard = requireSessionOrExplicitSelector('clipboard', session, flags);
  if (guard) return guard;

  const action = (req.positionals?.[0] ?? '').toLowerCase();
  if (action !== 'read' && action !== 'write') {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: 'clipboard requires a subcommand: read or write',
      },
    };
  }

  const device = await resolveCommandDevice({
    session,
    flags,
    ensureReady: true,
  });
  if (!isCommandSupportedOnDevice('clipboard', device)) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: 'clipboard is not supported on this device',
      },
    };
  }

  const result = await dispatchCommand(device, 'clipboard', req.positionals ?? [], req.flags?.out, {
    ...contextFromFlags(logPath, req.flags, session?.appBundleId, session?.trace?.outPath),
  });
  if (session) {
    sessionStore.recordAction(session, {
      command: req.command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: result ?? {},
    });
  }
  return { ok: true, data: { platform: device.platform, ...(result ?? {}) } };
}

export async function handleSessionCommands(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
}): Promise<DaemonResponse | null> {
  const { req, sessionName, logPath, sessionStore, invoke } = params;

  if (INVENTORY_COMMANDS.has(req.command)) {
    return await handleSessionInventoryCommands({
      req,
      sessionName,
      sessionStore,
    });
  }

  if (req.command === 'runtime') {
    return await handleRuntimeCommand({
      req,
      sessionName,
      sessionStore,
    });
  }

  if (STATE_COMMANDS.has(req.command)) {
    return await handleSessionStateCommands({
      req,
      sessionName,
      sessionStore,
    });
  }

  if (req.command === 'clipboard') {
    return await handleClipboardCommand({
      req,
      sessionName,
      logPath,
      sessionStore,
    });
  }

  if (req.command === 'keyboard') {
    const session = sessionStore.get(sessionName);
    const keyboardAction = req.positionals?.[0]?.trim().toLowerCase();
    if (!session && keyboardAction === 'dismiss') {
      const flags = req.flags ?? {};
      const normalizedPlatform = normalizePlatformSelector(flags.platform);
      if (normalizedPlatform === 'ios') {
        return {
          ok: false,
          error: {
            code: 'SESSION_NOT_FOUND',
            message:
              'iOS keyboard dismiss requires an active session so the target app stays foregrounded. Run open first.',
          },
        };
      }
    }
    return await runSessionOrSelectorDispatch({
      req,
      sessionName,
      logPath,
      sessionStore,
      command: 'keyboard',
      positionals: req.positionals ?? [],
    });
  }

  if (OBSERVABILITY_COMMANDS.has(req.command)) {
    return await handleSessionObservabilityCommands({
      req,
      sessionName,
      sessionStore,
    });
  }

  if (req.command === 'install' || req.command === 'reinstall') {
    return await handleAppDeployCommand({
      req,
      command: req.command,
      sessionName,
      sessionStore,
      deployOps: req.command === 'install' ? defaultInstallOps : defaultReinstallOps,
    });
  }

  if (req.command === 'install_source') {
    return await handleInstallFromSourceCommand({
      req,
      sessionName,
      sessionStore,
    });
  }

  if (req.command === 'release_materialized_paths') {
    return await handleReleaseMaterializedPathsCommand({ req });
  }

  if (req.command === 'push') {
    const appId = req.positionals?.[0]?.trim();
    const payloadArg = req.positionals?.[1]?.trim();
    if (!appId || !payloadArg) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'push requires <bundle|package> <payload.json|inline-json>',
        },
      };
    }

    return await runSessionOrSelectorDispatch({
      req,
      sessionName,
      logPath,
      sessionStore,
      command: 'push',
      positionals: [appId, maybeResolvePushPayloadPath(payloadArg, req.meta?.cwd)],
      recordPositionals: [appId, payloadArg],
    });
  }

  if (req.command === 'trigger-app-event') {
    return await runSessionOrSelectorDispatch({
      req,
      sessionName,
      logPath,
      sessionStore,
      command: 'trigger-app-event',
      positionals: req.positionals ?? [],
      deriveNextSession: async (session, result) => {
        const eventUrl = typeof result?.eventUrl === 'string' ? result.eventUrl : undefined;
        const nextAppBundleId = eventUrl
          ? ((await resolveSessionAppBundleIdForTarget(
              session.device,
              eventUrl,
              session.appBundleId,
              resolveAndroidPackageForOpen,
            )) ?? session.appBundleId)
          : session.appBundleId;
        return {
          ...session,
          appBundleId: nextAppBundleId,
        };
      },
    });
  }

  if (req.command === 'open') {
    return await handleOpenCommand({
      req,
      sessionName,
      logPath,
      sessionStore,
    });
  }

  if (REPLAY_COMMANDS.has(req.command)) {
    return await handleSessionReplayCommands({
      req,
      sessionName,
      logPath,
      sessionStore,
      invoke,
    });
  }

  if (req.command === 'batch') {
    return await runBatchCommands(req, sessionName, invoke);
  }

  if (req.command === 'close') {
    return await handleCloseCommand({
      req,
      sessionName,
      logPath,
      sessionStore,
    });
  }

  return null;
}

function maybeResolvePushPayloadPath(payloadArg: string, cwd?: string): string {
  const resolved = resolvePayloadInput(payloadArg, {
    subject: 'Push payload',
    cwd,
    expandPath: (value, currentCwd) => SessionStore.expandHome(value, currentCwd),
  });
  return resolved.kind === 'file' ? resolved.path : resolved.text;
}
