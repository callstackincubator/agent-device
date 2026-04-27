import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeError } from '../../utils/errors.ts';
import { findProjectRoot, readVersion } from '../../utils/version.ts';
import {
  parseAndroidSnapshotHelperManifest,
  type AndroidSnapshotHelperArtifact,
} from './snapshot-helper.ts';

export async function resolveAndroidSnapshotHelperConfig(options: {
  helperArtifact?: AndroidSnapshotHelperArtifact;
}): Promise<{ artifact?: AndroidSnapshotHelperArtifact; fallbackReason?: string }> {
  if (options.helperArtifact) {
    return { artifact: options.helperArtifact };
  }

  const apkPath = process.env.AGENT_DEVICE_ANDROID_SNAPSHOT_HELPER_APK?.trim();
  const manifestPath = process.env.AGENT_DEVICE_ANDROID_SNAPSHOT_HELPER_MANIFEST?.trim();
  if (!apkPath && !manifestPath) {
    return await resolveBundledAndroidSnapshotHelperConfig();
  }
  if (!apkPath || !manifestPath) {
    return {
      fallbackReason:
        'Android snapshot helper requires both AGENT_DEVICE_ANDROID_SNAPSHOT_HELPER_APK and AGENT_DEVICE_ANDROID_SNAPSHOT_HELPER_MANIFEST.',
    };
  }

  try {
    const manifest = parseAndroidSnapshotHelperManifest(
      JSON.parse(await fs.readFile(manifestPath, 'utf8')),
    );
    return {
      artifact: {
        apkPath,
        manifest,
      },
    };
  } catch (error) {
    return {
      fallbackReason: helperFallbackReason(error),
    };
  }
}

export function helperFallbackReason(error: unknown): string {
  return normalizeError(error).message;
}

async function resolveBundledAndroidSnapshotHelperConfig(): Promise<{
  artifact?: AndroidSnapshotHelperArtifact;
  fallbackReason?: string;
}> {
  const version = readVersion();
  const helperDir = path.join(findProjectRoot(), 'android-snapshot-helper', 'dist');
  const manifestPath = path.join(
    helperDir,
    `agent-device-android-snapshot-helper-${version}.manifest.json`,
  );
  try {
    await fs.access(manifestPath);
  } catch {
    return {};
  }

  try {
    const manifest = parseAndroidSnapshotHelperManifest(
      JSON.parse(await fs.readFile(manifestPath, 'utf8')),
    );
    const apkPath = path.join(
      helperDir,
      manifest.assetName ?? `agent-device-android-snapshot-helper-${manifest.version}.apk`,
    );
    await fs.access(apkPath);
    return {
      artifact: {
        apkPath,
        manifest,
      },
    };
  } catch (error) {
    return {
      fallbackReason: helperFallbackReason(error),
    };
  }
}
