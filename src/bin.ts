const argv = process.argv.slice(2);

import('./cli.ts').then(({ runCli }) => runCli(argv)).catch(handleStartupError);

function handleStartupError(error: unknown): void {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
