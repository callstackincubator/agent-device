import path from 'node:path';
import {
  isTrustedInstallSourceUrl,
  materializeInstallablePath,
  type MaterializeInstallSource,
} from '../install-source.ts';
import { resolveAndroidArchivePackageName } from './manifest.ts';

export type PreparedAndroidInstallArtifact = {
  archivePath?: string;
  installablePath: string;
  packageName?: string;
  cleanup: () => Promise<void>;
};

export async function prepareAndroidInstallArtifact(
  source: MaterializeInstallSource,
  options?: { signal?: AbortSignal; resolveIdentity?: boolean },
): Promise<PreparedAndroidInstallArtifact> {
  const trustedUrlSource = source.kind === 'url' && isTrustedInstallSourceUrl(source.url);
  const materialized = await materializeInstallablePath({
    source,
    isInstallablePath: (candidatePath, stat) =>
      stat.isFile() && isAndroidInstallablePath(candidatePath),
    installableLabel: 'Android installable (.apk or .aab)',
    allowArchiveExtraction: source.kind !== 'url' || trustedUrlSource,
    signal: options?.signal,
  });
  const identity = options?.resolveIdentity === false || (source.kind === 'url' && !trustedUrlSource)
    ? {}
    : await inspectAndroidArtifactIdentity(materialized.installablePath);
  return {
    archivePath: materialized.archivePath,
    installablePath: materialized.installablePath,
    packageName: identity.packageName,
    cleanup: materialized.cleanup,
  };
}

function isAndroidInstallablePath(candidatePath: string): boolean {
  const extension = path.extname(candidatePath).toLowerCase();
  return extension === '.apk' || extension === '.aab';
}

async function inspectAndroidArtifactIdentity(
  installablePath: string,
): Promise<{ packageName?: string }> {
  const extension = path.extname(installablePath).toLowerCase();
  if (extension !== '.apk' && extension !== '.aab') {
    return {};
  }
  const packageName = await resolveAndroidArchivePackageName(installablePath);
  return {
    packageName,
  };
}
