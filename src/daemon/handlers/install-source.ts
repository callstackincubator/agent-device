import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { resolveTargetDevice, type CommandFlags } from '../../core/dispatch.ts';
import { ensureDeviceReady } from '../device-ready.ts';
import { getRequestSignal } from '../request-cancel.ts';
import { SessionStore } from '../session-store.ts';
import type { DaemonInstallSource, DaemonRequest, DaemonResponse, SessionState } from '../types.ts';
import { AppError, normalizeError } from '../../utils/errors.ts';

function normalizePlatform(platform: CommandFlags['platform']): 'ios' | 'android' | undefined {
  return platform === 'ios' || platform === 'android' ? platform : undefined;
}

function requireInstallSource(req: DaemonRequest): DaemonInstallSource {
  const source = req.meta?.installSource;
  if (!source) {
    throw new AppError('INVALID_ARGS', 'install_from_source requires a source payload');
  }
  if (source.kind === 'url') {
    if (!source.url || source.url.trim().length === 0) {
      throw new AppError('INVALID_ARGS', 'install_from_source url source requires a non-empty url');
    }
    return source;
  }
  if (!source.path || source.path.trim().length === 0) {
    throw new AppError('INVALID_ARGS', 'install_from_source path source requires a non-empty path');
  }
  return source;
}

async function resolveInstallDevice(params: {
  session: SessionState | undefined;
  flags: DaemonRequest['flags'] | undefined;
}): Promise<SessionState['device']> {
  const requestedPlatform = normalizePlatform(params.flags?.platform);
  if (params.session) {
    if (requestedPlatform && params.session.device.platform !== requestedPlatform) {
      throw new AppError(
        'INVALID_ARGS',
        `install_from_source requested platform ${requestedPlatform}, but session is bound to ${params.session.device.platform}`,
      );
    }
    await ensureDeviceReady(params.session.device);
    return params.session.device;
  }

  if (!requestedPlatform) {
    throw new AppError('INVALID_ARGS', 'install_from_source requires platform "ios" or "android" when no session is provided');
  }
  const device = await resolveTargetDevice(params.flags ?? {});
  await ensureDeviceReady(device);
  return device;
}

export async function handleInstallFromSourceCommand(params: {
  req: DaemonRequest;
  sessionName: string;
  sessionStore: SessionStore;
}): Promise<DaemonResponse> {
  const { req, sessionName, sessionStore } = params;
  const session = sessionStore.get(sessionName);
  try {
    const source = requireInstallSource(req);
    const device = await resolveInstallDevice({
      session,
      flags: req.flags,
    });
    if (!isCommandSupportedOnDevice('install', device)) {
      return {
        ok: false,
        error: {
          code: 'UNSUPPORTED_OPERATION',
          message: 'install_from_source is not supported on this device',
        },
      };
    }

    const requestSignal = getRequestSignal(req.meta?.requestId);
    if (device.platform === 'ios') {
      const { installIosInstallablePath } = await import('../../platforms/ios/index.ts');
      const { prepareIosInstallArtifact } = await import('../../platforms/ios/install-artifact.ts');
      const prepared = await prepareIosInstallArtifact(source, { signal: requestSignal });
      try {
        await installIosInstallablePath(device, prepared.installablePath);
        if (!prepared.bundleId) {
          throw new AppError('COMMAND_FAILED', 'Installed iOS app identity could not be resolved from the artifact');
        }
        const result = {
          ...(prepared.archivePath ? { archivePath: prepared.archivePath } : {}),
          installablePath: prepared.installablePath,
          bundleId: prepared.bundleId,
          ...(prepared.appName ? { appName: prepared.appName } : {}),
          launchTarget: prepared.bundleId,
        };
        if (session) {
          sessionStore.recordAction(session, {
            command: 'install_source',
            positionals: [],
            flags: req.flags ?? {},
            result,
          });
        }
        return { ok: true, data: result };
      } finally {
        await prepared.cleanup();
      }
    }

    const { installAndroidInstallablePath } = await import('../../platforms/android/index.ts');
    const { prepareAndroidInstallArtifact } = await import('../../platforms/android/install-artifact.ts');
    const prepared = await prepareAndroidInstallArtifact(source, { signal: requestSignal });
    try {
      await installAndroidInstallablePath(device, prepared.installablePath);
      if (!prepared.packageName) {
        throw new AppError('COMMAND_FAILED', 'Installed Android package identity could not be resolved from the artifact');
      }
      const { inferAndroidAppName } = await import('../../platforms/android/index.ts');
      const result = {
        ...(prepared.archivePath ? { archivePath: prepared.archivePath } : {}),
        installablePath: prepared.installablePath,
        packageName: prepared.packageName,
        appName: inferAndroidAppName(prepared.packageName),
        launchTarget: prepared.packageName,
      };
      if (session) {
        sessionStore.recordAction(session, {
          command: 'install_source',
          positionals: [],
          flags: req.flags ?? {},
          result,
        });
      }
      return { ok: true, data: result };
    } finally {
      await prepared.cleanup();
    }
  } catch (error) {
    const normalized = normalizeError(error);
    return { ok: false, error: normalized };
  }
}
