import fs from 'node:fs/promises';
import { normalizeError } from '../../utils/errors.ts';
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
    return {};
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
