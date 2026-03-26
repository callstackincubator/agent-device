import { normalizePlatformSelector } from '../../utils/device.ts';
import type { DaemonRequest, DaemonResponse } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { clearRuntimeHintsFromApp, hasRuntimeTransportHints } from '../runtime-hints.ts';
import {
  buildRuntimeHints,
  countConfiguredRuntimeHints,
  mergeRuntimeHints,
  toRuntimePlatform,
} from './session-runtime.ts';

export async function handleRuntimeCommand(params: {
  req: DaemonRequest;
  sessionName: string;
  sessionStore: SessionStore;
}): Promise<DaemonResponse> {
  const { req, sessionName, sessionStore } = params;
  const action = (req.positionals?.[0] ?? 'show').toLowerCase();
  const session = sessionStore.get(sessionName);
  const current = sessionStore.getRuntimeHints(sessionName);
  if (!['set', 'show', 'clear'].includes(action)) {
    return {
      ok: false,
      error: { code: 'INVALID_ARGS', message: 'runtime requires set, show, or clear' },
    };
  }
  if (action === 'clear') {
    if (hasRuntimeTransportHints(current) && session?.appBundleId) {
      await clearRuntimeHintsFromApp({
        device: session.device,
        appId: session.appBundleId,
      });
    }
    const cleared = sessionStore.clearRuntimeHints(sessionName);
    return { ok: true, data: { session: sessionName, cleared } };
  }
  if (action === 'show') {
    return {
      ok: true,
      data: {
        session: sessionName,
        configured: Boolean(current),
        runtime: current,
      },
    };
  }

  const platform = toRuntimePlatform(
    normalizePlatformSelector(req.flags?.platform) ?? current?.platform ?? session?.device.platform,
  );
  if (!platform) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message:
          'runtime set only supports iOS and Android sessions. Pass --platform ios|android or open an iOS/Android session first.',
      },
    };
  }
  if (session && session.device.platform !== platform) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: `runtime set targets ${platform}, but session "${sessionName}" is already bound to ${session.device.platform}.`,
      },
    };
  }
  const nextRuntime = mergeRuntimeHints(current, buildRuntimeHints(req.flags, platform));
  if (countConfiguredRuntimeHints(nextRuntime) === 0) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message:
          'runtime set requires at least one hint such as --metro-host, --metro-port, --bundle-url, or --launch-url.',
      },
    };
  }
  sessionStore.setRuntimeHints(sessionName, nextRuntime);
  return {
    ok: true,
    data: {
      session: sessionName,
      configured: true,
      runtime: nextRuntime,
    },
  };
}
