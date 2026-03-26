import fs from 'node:fs';
import { cleanupUploadedArtifact, prepareUploadedArtifact } from '../upload-registry.ts';
import { resolveTargetDevice } from '../../core/dispatch.ts';
import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { ensureDeviceReady } from '../device-ready.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import type { DaemonRequest, DaemonResponse } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { requireSessionOrExplicitSelector, resolveCommandDevice } from './session-device-utils.ts';

export type ReinstallOps = {
  ios: (device: DeviceInfo, app: string, appPath: string) => Promise<{ bundleId: string }>;
  android: (device: DeviceInfo, app: string, appPath: string) => Promise<{ package: string }>;
};

export type AppDeployOps = {
  ios: (
    device: DeviceInfo,
    app: string,
    appPath: string,
  ) => Promise<{ bundleId?: string; appName?: string; launchTarget?: string }>;
  android: (
    device: DeviceInfo,
    app: string,
    appPath: string,
  ) => Promise<{ package?: string; appName?: string; launchTarget?: string }>;
};

export type InstallOps = AppDeployOps;

type DeployCommandResultBase = {
  app: string;
  appPath: string;
  appName?: string;
  launchTarget?: string;
};

type IosDeployCommandResult = DeployCommandResultBase & {
  platform: 'ios';
  appId?: string;
  bundleId?: string;
};

type AndroidDeployCommandResult = DeployCommandResultBase & {
  platform: 'android';
  appId?: string;
  package?: string;
  packageName?: string;
};

type DeployCommandResult = IosDeployCommandResult | AndroidDeployCommandResult;

export const defaultReinstallOps: ReinstallOps = {
  ios: async (device, app, appPath) => {
    const { reinstallIosApp } = await import('../../platforms/ios/index.ts');
    return await reinstallIosApp(device, app, appPath);
  },
  android: async (device, app, appPath) => {
    const { reinstallAndroidApp } = await import('../../platforms/android/index.ts');
    return await reinstallAndroidApp(device, app, appPath);
  },
};

export const defaultInstallOps: InstallOps = {
  ios: async (device, app, appPath) => {
    const { installIosApp } = await import('../../platforms/ios/index.ts');
    const result = await installIosApp(device, appPath, { appIdentifierHint: app });
    return {
      bundleId: result.bundleId,
      appName: result.appName,
      launchTarget: result.launchTarget,
    };
  },
  android: async (device, _app, appPath) => {
    const { installAndroidApp } = await import('../../platforms/android/index.ts');
    const result = await installAndroidApp(device, appPath);
    return {
      package: result.packageName,
      appName: result.appName,
      launchTarget: result.launchTarget,
    };
  },
};

export async function handleAppDeployCommand(params: {
  req: DaemonRequest;
  command: 'install' | 'reinstall';
  sessionName: string;
  sessionStore: SessionStore;
  ensureReady: typeof ensureDeviceReady;
  resolveDevice: typeof resolveTargetDevice;
  deployOps: AppDeployOps;
}): Promise<DaemonResponse> {
  const { req, command, sessionName, sessionStore, ensureReady, resolveDevice, deployOps } = params;
  const session = sessionStore.get(sessionName);
  const flags = req.flags ?? {};
  const guard = requireSessionOrExplicitSelector(command, session, flags);
  if (guard) return guard;
  const app = req.positionals?.[0]?.trim();
  const appPathInput = req.positionals?.[1]?.trim();
  if (!app || !appPathInput) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: `${command} requires: ${command} <app> <path-to-app-binary>`,
      },
    };
  }
  const uploadedArtifactId = req.meta?.uploadedArtifactId;

  try {
    const appPath = uploadedArtifactId
      ? prepareUploadedArtifact(uploadedArtifactId, req.meta?.tenantId)
      : SessionStore.expandHome(appPathInput);
    if (!fs.existsSync(appPath)) {
      return {
        ok: false,
        error: { code: 'INVALID_ARGS', message: `App binary not found: ${appPath}` },
      };
    }
    const device = await resolveCommandDevice({
      session,
      flags,
      ensureReadyFn: ensureReady,
      resolveTargetDeviceFn: resolveDevice,
      ensureReady: false,
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

    let result: DeployCommandResult;

    if (device.platform === 'ios') {
      const iosResult = await deployOps.ios(device, app, appPath);
      const bundleId = iosResult.bundleId;
      result = bundleId
        ? {
            app,
            appPath,
            platform: 'ios',
            appId: bundleId,
            bundleId,
            appName: iosResult.appName,
            launchTarget: iosResult.launchTarget,
          }
        : {
            app,
            appPath,
            platform: 'ios',
            appName: iosResult.appName,
            launchTarget: iosResult.launchTarget,
          };
    } else {
      const androidResult = await deployOps.android(device, app, appPath);
      const pkg = androidResult.package;
      result = pkg
        ? {
            app,
            appPath,
            platform: 'android',
            appId: pkg,
            package: pkg,
            packageName: pkg,
            appName: androidResult.appName,
            launchTarget: androidResult.launchTarget,
          }
        : {
            app,
            appPath,
            platform: 'android',
            appName: androidResult.appName,
            launchTarget: androidResult.launchTarget,
          };
    }

    if (session) {
      sessionStore.recordAction(session, {
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: { ...result, message: buildDeployMessage(result) },
      });
    }
    return { ok: true, data: { ...result, message: buildDeployMessage(result) } };
  } finally {
    if (uploadedArtifactId) {
      cleanupUploadedArtifact(uploadedArtifactId);
    }
  }
}

function buildDeployMessage(result: DeployCommandResult): string {
  let target = result.appName;
  if (!target) {
    target = 'bundleId' in result ? result.bundleId : undefined;
  }
  if (!target) {
    target = 'package' in result ? result.package : undefined;
  }
  if (!target) {
    target = result.app;
  }
  return `Installed: ${target}`;
}
