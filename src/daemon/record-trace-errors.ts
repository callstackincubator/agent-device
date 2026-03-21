export function formatRecordTraceError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatRecordTraceExecFailure(
  result: { stdout: string; stderr: string; exitCode: number },
  command: string,
): string {
  return (
    result.stderr.trim() || result.stdout.trim() || `${command} exited with code ${result.exitCode}`
  );
}
