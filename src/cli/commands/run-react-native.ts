import { serializeInstallFromSourceResult, serializeOpenResult } from '../../client-shared.ts';
import type { AppInstallFromSourceResult } from '../../client-types.ts';
import { AppError } from '../../utils/errors.ts';
import { buildSelectionOptions, writeCommandOutput } from './shared.ts';
import { parseInstallSourceHeaders } from './install.ts';
import type { ClientCommandHandler } from './router.ts';

export const runReactNativeCommand: ClientCommandHandler = async ({
  positionals,
  flags,
  client,
}) => {
  const platform = readReactNativePlatform(positionals);
  if (flags.platform && flags.platform !== platform) {
    throw new AppError(
      'INVALID_ARGS',
      `run-react-native ${platform} conflicts with --platform ${flags.platform}.`,
    );
  }
  const app = flags.app?.trim();
  if (!app) {
    throw new AppError('INVALID_ARGS', 'run-react-native requires --app <bundle-or-package-id>.');
  }
  const effectiveFlags = { ...flags, platform };
  let installed: AppInstallFromSourceResult | undefined;
  if (flags.installFromSource) {
    installed = await client.apps.installFromSource({
      ...buildSelectionOptions(effectiveFlags),
      retainPaths: flags.retainPaths,
      retentionMs: flags.retentionMs,
      source: {
        kind: 'url',
        url: flags.installFromSource,
        headers: parseInstallSourceHeaders(flags.header),
      },
    });
  }
  const opened = await client.apps.open({
    ...buildSelectionOptions(effectiveFlags),
    app,
    activity: flags.activity,
    relaunch: flags.relaunch ?? Boolean(installed),
    saveScript: flags.saveScript,
    noRecord: flags.noRecord,
  });
  const installData = installed ? serializeInstallFromSourceResult(installed) : undefined;
  const openData = serializeOpenResult(opened);
  writeCommandOutput(
    flags,
    {
      platform,
      app,
      ...(installData ? { installed: stripSuccessText(installData) } : {}),
      opened: stripSuccessText(openData),
    },
    () =>
      [installData?.message, openData.message]
        .filter((line): line is string => typeof line === 'string' && line.length > 0)
        .join('\n'),
  );
  return true;
};

function readReactNativePlatform(positionals: string[]): 'ios' | 'android' {
  const platform = positionals[0];
  if (platform !== 'ios' && platform !== 'android') {
    throw new AppError(
      'INVALID_ARGS',
      'run-react-native requires platform: run-react-native ios|android --app <id>.',
    );
  }
  if (positionals.length > 1) {
    throw new AppError(
      'INVALID_ARGS',
      'run-react-native accepts exactly one positional argument: ios|android.',
    );
  }
  return platform;
}

function stripSuccessText(data: Record<string, unknown>): Record<string, unknown> {
  const { message: _message, ...rest } = data;
  return rest;
}
