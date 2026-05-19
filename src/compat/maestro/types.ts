import type { ParsedReplayScript, ReplayScriptMetadata } from '../../replay/script.ts';

export type MaestroFlowConfig = {
  appId?: string;
  env?: Record<string, string>;
  onFlowStart?: MaestroCommand[];
  onFlowComplete?: MaestroCommand[];
};

export type MaestroReplayFlow = ParsedReplayScript & {
  metadata: ReplayScriptMetadata;
};

export type MaestroCommand = string | Record<string, unknown>;

export type MaestroParseOptions = {
  sourcePath?: string;
  platform?: string;
  env?: Record<string, string>;
  visitedPaths?: Set<string>;
};

export type MaestroParseContext = {
  baseDir?: string;
  platform?: 'android' | 'ios';
  env: Record<string, string>;
  envOverrides: Record<string, string>;
  visitedPaths: Set<string>;
};

export type MaestroCommandMapperDeps = {
  parseRunFlowFile(filePath: string, context: MaestroParseContext): MaestroReplayFlow;
};

export type PermissionCommand = 'grant' | 'deny' | 'reset';
