import { AppError } from '../../utils/errors.ts';
import {
  readAndroidSnapshotHelperInstallArgs,
  verifyAndroidSnapshotHelperArtifact,
} from './snapshot-helper-artifact.ts';
import type {
  AndroidAdbExecutor,
  AndroidSnapshotHelperArtifact,
  AndroidSnapshotHelperInstallPolicy,
  AndroidSnapshotHelperInstallResult,
} from './snapshot-helper-types.ts';

export async function ensureAndroidSnapshotHelper(options: {
  adb: AndroidAdbExecutor;
  artifact: AndroidSnapshotHelperArtifact;
  installPolicy?: AndroidSnapshotHelperInstallPolicy;
  timeoutMs?: number;
}): Promise<AndroidSnapshotHelperInstallResult> {
  const { adb, artifact } = options;
  const installPolicy = options.installPolicy ?? 'missing-or-outdated';
  const packageName = artifact.manifest.packageName;
  const versionCode = artifact.manifest.versionCode;
  if (installPolicy === 'never') {
    return {
      packageName,
      versionCode,
      installed: false,
      reason: 'skipped',
    };
  }
  const installedVersionCode = await readInstalledVersionCode(adb, packageName, options.timeoutMs);
  const reason = getInstallReason(installPolicy, installedVersionCode, versionCode);

  if (reason === 'current') {
    return {
      packageName,
      versionCode,
      installedVersionCode,
      installed: false,
      reason,
    };
  }

  await verifyAndroidSnapshotHelperArtifact(artifact);
  const installArgs = [
    ...readAndroidSnapshotHelperInstallArgs(artifact.manifest),
    artifact.apkPath,
  ];
  const result = await installAndroidSnapshotHelper(adb, installArgs, {
    packageName,
    timeoutMs: options.timeoutMs,
  });
  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', 'Failed to install Android snapshot helper', {
      packageName,
      versionCode,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  }

  return {
    packageName,
    versionCode,
    installedVersionCode,
    installed: true,
    reason,
  };
}

async function readInstalledVersionCode(
  adb: AndroidAdbExecutor,
  packageName: string,
  timeoutMs: number | undefined,
): Promise<number | undefined> {
  const result = await adb(
    ['shell', 'cmd', 'package', 'list', 'packages', '--show-versioncode', packageName],
    {
      allowFailure: true,
      timeoutMs,
    },
  );
  if (result.exitCode === 0) {
    return parsePackageListVersionCode(`${result.stdout}\n${result.stderr}`, packageName);
  }
  return undefined;
}

async function installAndroidSnapshotHelper(
  adb: AndroidAdbExecutor,
  installArgs: string[],
  options: { packageName: string; timeoutMs?: number },
): Promise<Awaited<ReturnType<AndroidAdbExecutor>>> {
  const result = await adb(installArgs, { allowFailure: true, timeoutMs: options.timeoutMs });
  if (result.exitCode === 0 || !isInstallUpdateIncompatible(result)) {
    return result;
  }

  const uninstall = await adb(['uninstall', options.packageName], {
    allowFailure: true,
    timeoutMs: options.timeoutMs,
  });
  const retry = await adb(installArgs, { allowFailure: true, timeoutMs: options.timeoutMs });
  if (retry.exitCode === 0) {
    return retry;
  }

  return {
    ...retry,
    stderr: [
      retry.stderr,
      uninstall.stderr
        ? `Previous uninstall stderr after INSTALL_FAILED_UPDATE_INCOMPATIBLE: ${uninstall.stderr}`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

function parsePackageListVersionCode(output: string, packageName: string): number | undefined {
  const packagePrefix = `package:${packageName}`;
  for (const line of output.split(/\r?\n/)) {
    if (
      !line.startsWith(packagePrefix) ||
      (line.length > packagePrefix.length && !/\s/.test(line[packagePrefix.length] ?? ''))
    ) {
      continue;
    }
    const match = /(?:^|\s)versionCode:(\d+)(?:\s|$)/.exec(line);
    if (match) {
      return Number(match[1]);
    }
  }
  return undefined;
}

function isInstallUpdateIncompatible(result: { stdout: string; stderr: string }): boolean {
  return `${result.stdout}\n${result.stderr}`.includes('INSTALL_FAILED_UPDATE_INCOMPATIBLE');
}

function getInstallReason(
  installPolicy: AndroidSnapshotHelperInstallPolicy,
  installedVersionCode: number | undefined,
  requiredVersionCode: number,
): AndroidSnapshotHelperInstallResult['reason'] {
  if (installPolicy === 'never') {
    return 'skipped';
  }
  if (installPolicy === 'always') {
    return 'forced';
  }
  if (installedVersionCode === undefined) {
    return 'missing';
  }
  return installedVersionCode < requiredVersionCode ? 'outdated' : 'current';
}
