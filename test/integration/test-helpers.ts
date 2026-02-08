import { runCmdSync } from '../../src/utils/exec.ts';

export type CliJsonResult = {
  status: number;
  json?: any;
  stdout: string;
  stderr: string;
};

export function runCliJson(args: string[]): CliJsonResult {
  const result = runCmdSync(
    process.execPath,
    ['--experimental-strip-types', 'src/bin.ts', ...args],
    { allowFailure: true },
  );
  let json: any;
  try {
    json = JSON.parse(result.stdout ?? '');
  } catch {
    json = undefined;
  }
  return {
    status: result.exitCode,
    json,
    stdout: json ? '<JSON output>' : result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export function formatResultDebug(step: string, args: string[], result: CliJsonResult): string {
  const jsonText =
    result.json === undefined ? '(unparseable)' : JSON.stringify(result.json, null, 2);
  return [
    `step: ${step}`,
    `command: agent-device ${args.join(' ')}`,
    `status: ${result.status}`,
    `stderr:`,
    result.stderr || '(empty)',
    `stdout:`,
    result.stdout || '(empty)',
    `json:`,
    jsonText,
  ].join('\n');
}
