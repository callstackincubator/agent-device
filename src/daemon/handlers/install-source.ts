import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { resolveTargetDevice, type CommandFlags } from '../../core/dispatch.ts';
import { ensureDeviceReady } from '../device-ready.ts';
import { getRequestSignal } from '../request-cancel.ts';
import {
  cleanupRetainedMaterializedPaths,
  retainMaterializedPaths,
} from '../materialized-path-registry.ts';
import { resolveInstallSource } from '../install-source-resolution.ts';
import { SessionStore } from '../session-store.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../types.ts';
import { AppError, normalizeError } from '../../utils/errors.ts';

function normalizePlatform(platform: CommandFlags['platform']): 'ios' | 'android' | undefined {
  return platform === 'ios' || platform === 'android' ? platform : undefined;
}

function resolveRetainMaterializedPaths(req: DaemonRequest): { enabled: boolean; ttlMs?: number } {
  const enabled = req.meta?.retainMaterializedPaths === true;
  const ttlMs = req.meta?.materializedPathRetentionMs;
  if (!enabled) return { enabled: false };
  if (ttlMs !== undefined && ttlMs <= 0) {
    throw new AppError(
      'INVALID_ARGS',
      'install_from_source retentionMs must be a positive integer',
    );
  }
  return { enabled: true, ttlMs };
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
    throw new AppError(
      'INVALID_ARGS',
      'install_from_source requires platform "ios" or "android" when no session is provided',
    );
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
    const resolvedSource = resolveInstallSource(req);
    const retention = resolveRetainMaterializedPaths(req);
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
      const prepared = await prepareIosInstallArtifact(resolvedSource.source, {
        signal: requestSignal,
      });
      let retained: Awaited<ReturnType<typeof retainMaterializedPaths>> | undefined;
      try {
        if (retention.enabled) {
          retained = await retainMaterializedPaths({
            archivePath: prepared.archivePath,
            installablePath: prepared.installablePath,
            tenantId: req.meta?.tenantId,
            sessionName: session ? sessionName : undefined,
            ttlMs: retention.ttlMs,
          });
        }
        await installIosInstallablePath(device, prepared.installablePath);
        if (!prepared.bundleId) {
          throw new AppError(
            'COMMAND_FAILED',
            'Installed iOS app identity could not be resolved from the artifact',
          );
        }
        const result = {
          ...(retained?.archivePath ? { archivePath: retained.archivePath } : {}),
          ...(retained ? { installablePath: retained.installablePath } : {}),
          bundleId: prepared.bundleId,
          ...(prepared.appName ? { appName: prepared.appName } : {}),
          launchTarget: prepared.bundleId,
          ...(retained
            ? {
                materializationId: retained.materializationId,
                materializationExpiresAt: retained.expiresAt,
              }
            : {}),
        };
        if (session) {
          sessionStore.recordAction(session, {
            command: 'install_source',
            positionals: [],
            flags: req.flags ?? {},
            result: { ...result, message: buildInstallFromSourceMessage(result) },
          });
        }
        return { ok: true, data: { ...result, message: buildInstallFromSourceMessage(result) } };
      } catch (error) {
        if (retained) {
          await cleanupRetainedMaterializedPaths(
            retained.materializationId,
            req.meta?.tenantId,
          ).catch(() => {});
        }
        throw error;
      } finally {
        await prepared.cleanup();
        resolvedSource.cleanup();
      }
    }

    const { prepareAndroidInstallArtifact } =
      await import('../../platforms/android/install-artifact.ts');
    const { installAndroidInstallablePathAndResolvePackageName } =
      await import('../../platforms/android/index.ts');
    const prepared = await prepareAndroidInstallArtifact(resolvedSource.source, {
      signal: requestSignal,
    });
    let retained: Awaited<ReturnType<typeof retainMaterializedPaths>> | undefined;
    try {
      if (retention.enabled) {
        retained = await retainMaterializedPaths({
          archivePath: prepared.archivePath,
          installablePath: prepared.installablePath,
          tenantId: req.meta?.tenantId,
          sessionName: session ? sessionName : undefined,
          ttlMs: retention.ttlMs,
        });
      }
      const packageName = await installAndroidInstallablePathAndResolvePackageName(
        device,
        prepared.installablePath,
        prepared.packageName,
      );
      if (!packageName) {
        throw new AppError(
          'COMMAND_FAILED',
          'Installed Android app identity could not be resolved from the artifact or device state',
        );
      }
      const { inferAndroidAppName } = await import('../../platforms/android/index.ts');
      const appName = inferAndroidAppName(packageName);
      const result = {
        ...(retained?.archivePath ? { archivePath: retained.archivePath } : {}),
        ...(retained ? { installablePath: retained.installablePath } : {}),
        packageName,
        ...(appName ? { appName } : {}),
        launchTarget: packageName,
        ...(retained
          ? {
              materializationId: retained.materializationId,
              materializationExpiresAt: retained.expiresAt,
            }
          : {}),
      };
      if (session) {
        sessionStore.recordAction(session, {
          command: 'install_source',
          positionals: [],
          flags: req.flags ?? {},
          result: { ...result, message: buildInstallFromSourceMessage(result) },
        });
      }
      return { ok: true, data: { ...result, message: buildInstallFromSourceMessage(result) } };
    } catch (error) {
      if (retained) {
        await cleanupRetainedMaterializedPaths(
          retained.materializationId,
          req.meta?.tenantId,
        ).catch(() => {});
      }
      throw error;
    } finally {
      await prepared.cleanup();
      resolvedSource.cleanup();
    }
  } catch (error) {
    const normalized = normalizeError(error);
    return { ok: false, error: normalized };
  }
}

function buildInstallFromSourceMessage(result: {
  appName?: string;
  bundleId?: string;
  packageName?: string;
  launchTarget: string;
}): string {
  return `Installed: ${result.appName ?? result.bundleId ?? result.packageName ?? result.launchTarget}`;
}

export async function handleReleaseMaterializedPathsCommand(params: {
  req: DaemonRequest;
}): Promise<DaemonResponse> {
  const { req } = params;
  try {
    const materializationId = req.meta?.materializationId?.trim();
    if (!materializationId) {
      throw new AppError('INVALID_ARGS', 'release_materialized_paths requires a materializationId');
    }
    await cleanupRetainedMaterializedPaths(materializationId, req.meta?.tenantId);
    return {
      ok: true,
      data: {
        released: true,
        materializationId,
      },
    };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}
