import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppError } from './utils/errors.ts';

export type FileInputRef =
  | {
      kind: 'path';
      path: string;
    }
  | {
      kind: 'uploadedArtifact';
      id: string;
    };

export type FileOutputRef =
  | {
      kind: 'path';
      path: string;
    }
  | {
      kind: 'downloadableArtifact';
      clientPath?: string;
      fileName?: string;
    };

export type ArtifactDescriptor =
  | {
      kind: 'localPath';
      field: string;
      path: string;
      fileName?: string;
      metadata?: Record<string, unknown>;
    }
  | {
      kind: 'artifact';
      field: string;
      artifactId: string;
      fileName?: string;
      url?: string;
      clientPath?: string;
      metadata?: Record<string, unknown>;
    };

export type ResolvedInputFile = {
  path: string;
  cleanup?: () => Promise<void>;
};

export type ReservedOutputFile = {
  path: string;
  publish: () => Promise<ArtifactDescriptor | undefined>;
  cleanup?: () => Promise<void>;
};

export type TemporaryFile = {
  path: string;
  cleanup: () => Promise<void>;
};

export type ResolveInputOptions = {
  usage: string;
  field?: string;
};

export type ReserveOutputOptions = {
  field: string;
  ext: string;
  requestedClientPath?: string;
};

export type CreateTempFileOptions = {
  prefix: string;
  ext: string;
};

export type ArtifactAdapter = {
  resolveInput(ref: FileInputRef, options: ResolveInputOptions): Promise<ResolvedInputFile>;
  reserveOutput(
    ref: FileOutputRef | undefined,
    options: ReserveOutputOptions,
  ): Promise<ReservedOutputFile>;
  createTempFile(options: CreateTempFileOptions): Promise<TemporaryFile>;
};

export type LocalArtifactAdapterOptions = {
  cwd?: string;
  tempDir?: string;
};

export function createLocalArtifactAdapter(
  options: LocalArtifactAdapterOptions = {},
): ArtifactAdapter {
  const cwd = options.cwd ?? process.cwd();
  const tempDir = options.tempDir ?? os.tmpdir();

  return {
    resolveInput: async (ref) => {
      if (ref.kind === 'uploadedArtifact') {
        throw new AppError(
          'UNSUPPORTED_OPERATION',
          'Uploaded artifact inputs require a custom artifact adapter',
        );
      }
      return { path: resolveLocalPath(ref.path, cwd) };
    },
    reserveOutput: async (ref, outputOptions) => {
      let tempRoot: string | undefined;
      const outputPath =
        ref?.kind === 'path'
          ? resolveLocalPath(ref.path, cwd)
          : path.join(
              (tempRoot = await fs.mkdtemp(
                path.join(tempDir, `agent-device-${outputOptions.field}-`),
              )),
              `${outputOptions.field}${outputOptions.ext}`,
            );
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      return {
        path: outputPath,
        ...(tempRoot
          ? {
              cleanup: async () => {
                await fs.rm(tempRoot, { recursive: true, force: true });
              },
            }
          : {}),
        publish: async () =>
          ref?.kind === 'downloadableArtifact'
            ? {
                kind: 'localPath',
                field: outputOptions.field,
                path: outputPath,
                fileName: ref.fileName ?? path.basename(ref.clientPath ?? outputPath),
              }
            : undefined,
      };
    },
    createTempFile: async (tempOptions) => {
      const root = await fs.mkdtemp(path.join(tempDir, `${tempOptions.prefix}-`));
      return {
        path: path.join(root, `file${tempOptions.ext}`),
        cleanup: async () => {
          await fs.rm(root, { recursive: true, force: true });
        },
      };
    },
  };
}

function resolveLocalPath(filePath: string, cwd: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}
