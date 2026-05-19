import fs from 'node:fs';
import path from 'node:path';
import { parseAllDocuments } from 'yaml';
import type { SessionAction } from '../../daemon/types.ts';
import { AppError } from '../../utils/errors.ts';
import { convertMaestroCommandWithLine } from './command-mapper.ts';
import { isPlainRecord, normalizeCommandList, normalizePlatform, readEnvMap } from './support.ts';
import type {
  MaestroCommand,
  MaestroFlowConfig,
  MaestroParseContext,
  MaestroParseOptions,
  MaestroReplayFlow,
} from './types.ts';

export function parseMaestroReplayFlow(
  script: string,
  options: MaestroParseOptions = {},
): MaestroReplayFlow {
  return parseMaestroReplayFlowInternal(script, createParseContext(options));
}

function parseMaestroReplayFlowInternal(
  script: string,
  context: MaestroParseContext,
): MaestroReplayFlow {
  const values = parseYamlDocuments(script);
  const { config, commands } = splitMaestroDocuments(values);
  const nextContext = {
    ...context,
    env: { ...context.env, ...(config.env ?? {}), ...context.envOverrides },
  };
  const commandLines = findMaestroCommandLines(script);
  const { actions, actionLines } = convertRootCommands({
    config,
    commands,
    commandLines,
    context: nextContext,
  });

  return {
    actions,
    actionLines,
    metadata: {
      env: config.env,
    },
  };
}

function convertRootCommands(params: {
  config: MaestroFlowConfig;
  commands: MaestroCommand[];
  commandLines: number[];
  context: MaestroParseContext;
}): { actions: SessionAction[]; actionLines: number[] } {
  const { config, commands, commandLines, context } = params;
  const allCommands = [
    ...(config.onFlowStart ?? []),
    ...commands,
    ...(config.onFlowComplete ?? []),
  ];
  const allCommandLines = [
    ...Array.from({ length: config.onFlowStart?.length ?? 0 }, () => 1),
    ...commandLines,
    ...Array.from({ length: config.onFlowComplete?.length ?? 0 }, () => commandLines.at(-1) ?? 1),
  ];
  const actions: SessionAction[] = [];
  const actionLines: number[] = [];
  for (const [index, command] of allCommands.entries()) {
    const line = allCommandLines[index] ?? index + 1;
    const converted = convertMaestroCommandWithLine(command, config, line, context, {
      parseRunFlowFile,
    });
    actions.push(...converted);
    converted.forEach(() => actionLines.push(line));
  }
  return { actions, actionLines };
}

function parseYamlDocuments(script: string): unknown[] {
  const documents = parseAllDocuments(script);
  for (const document of documents) {
    if (document.errors.length > 0) {
      const message = document.errors[0]?.message ?? 'Invalid Maestro YAML flow.';
      throw new AppError('INVALID_ARGS', `Invalid Maestro YAML flow: ${message}`);
    }
  }
  return documents
    .map((document) => document.toJSON() as unknown)
    .filter((value) => value !== null);
}

function createParseContext(options: MaestroParseOptions): MaestroParseContext {
  const visitedPaths = options.visitedPaths ?? new Set<string>();
  if (options.sourcePath) visitedPaths.add(path.resolve(options.sourcePath));
  return {
    baseDir: options.sourcePath ? path.dirname(options.sourcePath) : undefined,
    platform: normalizePlatform(options.platform),
    env: {},
    envOverrides: options.env ?? {},
    visitedPaths,
  };
}

function findMaestroCommandLines(script: string): number[] {
  const lines = script.split(/\r?\n/);
  const separatorIndex = lines.findIndex((line) => line.trim() === '---');
  const firstCommandLine = separatorIndex === -1 ? 0 : separatorIndex + 1;
  const commandLines: number[] = [];
  for (let index = firstCommandLine; index < lines.length; index += 1) {
    if (/^-\s+/.test(lines[index] ?? '')) commandLines.push(index + 1);
  }
  return commandLines;
}

function splitMaestroDocuments(values: unknown[]): {
  config: MaestroFlowConfig;
  commands: MaestroCommand[];
} {
  if (values.length === 0) {
    throw new AppError('INVALID_ARGS', 'Maestro flow is empty.');
  }

  if (Array.isArray(values[0])) {
    return { config: {}, commands: normalizeCommandList(values[0]) };
  }

  const config = normalizeConfig(values[0]);
  const commandDocument = values[1];
  if (!Array.isArray(commandDocument)) {
    throw new AppError(
      'INVALID_ARGS',
      'Maestro flow must contain a command list after the YAML document separator.',
    );
  }
  return { config, commands: normalizeCommandList(commandDocument) };
}

function normalizeConfig(value: unknown): MaestroFlowConfig {
  if (!isPlainRecord(value)) {
    throw new AppError('INVALID_ARGS', 'Maestro flow config must be a YAML map.');
  }
  return {
    ...(typeof value.appId === 'string' && value.appId.length > 0 ? { appId: value.appId } : {}),
    ...(isPlainRecord(value.env) ? { env: readEnvMap(value.env, 'env') } : {}),
    ...(Array.isArray(value.onFlowStart)
      ? { onFlowStart: normalizeCommandList(value.onFlowStart) }
      : {}),
    ...(Array.isArray(value.onFlowComplete)
      ? { onFlowComplete: normalizeCommandList(value.onFlowComplete) }
      : {}),
  };
}

function parseRunFlowFile(filePath: string, context: MaestroParseContext): MaestroReplayFlow {
  const resolved = resolveRunFlowPath(filePath, context);
  if (context.visitedPaths.has(resolved)) {
    throw new AppError('INVALID_ARGS', `Maestro runFlow cycle detected at ${resolved}.`);
  }
  const script = fs.readFileSync(resolved, 'utf8');
  const visitedPaths = new Set(context.visitedPaths);
  visitedPaths.add(resolved);
  return parseMaestroReplayFlowInternal(script, {
    ...context,
    baseDir: path.dirname(resolved),
    visitedPaths,
  });
}

function resolveRunFlowPath(filePath: string, context: MaestroParseContext): string {
  if (path.isAbsolute(filePath)) return filePath;
  if (!context.baseDir) {
    throw new AppError(
      'INVALID_ARGS',
      'runFlow file paths require replay input to have a source path.',
    );
  }
  return path.resolve(context.baseDir, filePath);
}
