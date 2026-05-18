export type CommandAttemptFailure = {
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number;
};

export function summarizeCommandAttemptFailures(
  failures: CommandAttemptFailure[],
): Array<{ args: string; exitCode: number; stderr: string }> {
  return failures.map((failure) => ({
    args: failure.args.join(' '),
    exitCode: failure.exitCode,
    stderr: failure.stderr.slice(0, 400),
  }));
}
