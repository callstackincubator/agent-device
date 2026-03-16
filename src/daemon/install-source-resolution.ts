import { AppError } from '../utils/errors.ts';
import { cleanupUploadedArtifact, prepareUploadedArtifact } from './upload-registry.ts';
import type { DaemonInstallSource, DaemonRequest } from './types.ts';

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

export function resolveInstallSource(req: DaemonRequest): {
  source: DaemonInstallSource;
  cleanup: () => void;
} {
  const source = requireInstallSource(req);
  const uploadedArtifactId = req.meta?.uploadedArtifactId;
  if (!uploadedArtifactId || source.kind !== 'path') {
    return { source, cleanup: () => {} };
  }
  return {
    source: {
      kind: 'path',
      path: prepareUploadedArtifact(uploadedArtifactId, req.meta?.tenantId),
    },
    cleanup: () => {
      cleanupUploadedArtifact(uploadedArtifactId);
    },
  };
}
