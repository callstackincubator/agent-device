import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { AppError } from '../../utils/errors.ts';
import { runCmdSync } from '../../utils/exec.ts';
import {
  assertOnlyKeys,
  isPlainRecord,
  readEnvMap,
  requireStringValue,
  resolveMaestroString,
} from './support.ts';
import type { MaestroParseContext } from './types.ts';

type HttpResponse = {
  status: number;
  body: string;
  headers: Record<string, string>;
};

const HTTP_REQUEST_SCRIPT = `
const fs = require('node:fs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
fetch(input.url, {
  method: input.method,
  headers: input.headers,
  body: input.body,
}).then(async response => {
  process.stdout.write(JSON.stringify({
    status: response.status,
    body: await response.text(),
    headers: Object.fromEntries(response.headers.entries()),
  }));
}).catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
`;

export function executeRunScript(value: unknown, context: MaestroParseContext): void {
  const scriptConfig = readRunScriptConfig(value, context);
  const scriptPath = resolveRunScriptPath(scriptConfig.file, context);
  const script = fs.readFileSync(scriptPath, 'utf8');
  const output: Record<string, unknown> = {};
  const scriptEnv = {
    ...context.env,
    ...scriptConfig.env,
    ...context.envOverrides,
  };

  try {
    vm.runInNewContext(script, buildScriptGlobals(scriptEnv, output), {
      filename: scriptPath,
      timeout: 30_000,
    });
  } catch (error) {
    throw new AppError(
      'COMMAND_FAILED',
      `Maestro runScript failed for ${scriptPath}: ${error instanceof Error ? error.message : String(error)}`,
      { scriptPath },
      error instanceof Error ? error : undefined,
    );
  }

  for (const [key, rawValue] of Object.entries(output)) {
    context.env[`output.${key}`] = stringifyOutputValue(rawValue);
  }
}

function readRunScriptConfig(
  value: unknown,
  context: MaestroParseContext,
): { file: string; env: Record<string, string> } {
  if (typeof value === 'string') {
    return { file: resolveMaestroString(value, context), env: {} };
  }
  if (!isPlainRecord(value)) {
    throw new AppError('INVALID_ARGS', 'runScript expects a file path string or map.');
  }
  assertOnlyKeys(value, 'runScript', ['file', 'env']);
  const file = resolveMaestroString(requireStringValue('runScript.file', value.file), context);
  const rawEnv = readEnvMap(value.env, 'runScript.env');
  const env = Object.fromEntries(
    Object.entries(rawEnv).map(([key, envValue]) => [key, resolveMaestroString(envValue, context)]),
  );
  return { file, env };
}

function resolveRunScriptPath(filePath: string, context: MaestroParseContext): string {
  if (path.isAbsolute(filePath)) return filePath;
  if (!context.baseDir) {
    throw new AppError(
      'INVALID_ARGS',
      'runScript file paths require replay input to have a source path.',
    );
  }
  return path.resolve(context.baseDir, filePath);
}

function buildScriptGlobals(
  env: Record<string, string>,
  output: Record<string, unknown>,
): vm.Context {
  return {
    ...env,
    output,
    json: (value: string) => JSON.parse(value) as unknown,
    http: {
      post: (url: string, options?: { headers?: Record<string, string>; body?: string }) =>
        runHttpRequestSync('POST', url, options),
    },
  };
}

function runHttpRequestSync(
  method: string,
  url: string,
  options?: { headers?: Record<string, string>; body?: string },
): HttpResponse {
  const result = runCmdSync(process.execPath, ['-e', HTTP_REQUEST_SCRIPT], {
    stdin: JSON.stringify({
      method,
      url,
      headers: options?.headers ?? {},
      body: options?.body ?? '',
    }),
    timeoutMs: 30_000,
  });
  return JSON.parse(result.stdout) as HttpResponse;
}

function stringifyOutputValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
