const argv = process.argv.slice(2);

if (runFastPath(argv)) {
  // Fast path owns process output and exit behavior.
} else if (argv[0] === 'mcp' && !argv.includes('--help') && !argv.includes('-h')) {
  import('./mcp/server.ts')
    .then(({ runAgentDeviceMcpServer }) => runAgentDeviceMcpServer())
    .catch(handleStartupError);
} else {
  runCli(argv);
}

function runFastPath(argv: string[]): boolean {
  return runVersionFastPath(argv) || runNoCommandFastPath(argv) || runHelpFastPath(argv);
}

function runVersionFastPath(argv: string[]): boolean {
  if (argv.length !== 1 || !isVersionFlag(argv[0])) return false;
  import('./utils/version.ts')
    .then(({ readVersion }) => {
      process.stdout.write(`${readVersion()}\n`);
    })
    .catch(handleStartupError);
  return true;
}

function runNoCommandFastPath(argv: string[]): boolean {
  if (argv.length !== 0) return false;
  import('./utils/args.ts')
    .then(({ usage }) => {
      process.stdout.write(`${usage()}\n`);
      process.exit(1);
    })
    .catch(handleStartupError);
  return true;
}

function runHelpFastPath(argv: string[]): boolean {
  const helpTarget = resolveSimpleHelpTarget(argv);
  if (helpTarget === undefined) return false;

  import('./utils/args.ts')
    .then(({ usage, usageForCommand }) => {
      if (helpTarget === null) {
        process.stdout.write(`${usage()}\n`);
        return;
      }
      const commandHelp = usageForCommand(helpTarget);
      if (commandHelp) {
        process.stdout.write(commandHelp);
        return;
      }
      // Unknown help topics still need full CLI parsing for the normal error path.
      runCli(argv);
    })
    .catch(handleStartupError);
  return true;
}

function resolveSimpleHelpTarget(argv: string[]): string | null | undefined {
  switch (argv.length) {
    case 1:
      return resolveSingleArgHelpTarget(argv[0]);
    case 2:
      return resolveTwoArgHelpTarget(argv[0], argv[1]);
    default:
      return undefined;
  }
}

function resolveSingleArgHelpTarget(arg: string | undefined): null | undefined {
  if (arg === 'help') return null;
  return isHelpFlag(arg) ? null : undefined;
}

function resolveTwoArgHelpTarget(
  command: string | undefined,
  helpArg: string | undefined,
): string | undefined {
  if (isHelpCommand(command)) return helpArg;
  return resolveTrailingHelpTarget(command, helpArg);
}

function resolveTrailingHelpTarget(
  command: string | undefined,
  helpArg: string | undefined,
): string | undefined {
  return isHelpFlag(helpArg) ? command : undefined;
}

function isHelpCommand(command: string | undefined): boolean {
  return command === 'help';
}

function isHelpFlag(arg: string | undefined): boolean {
  return arg === '--help' || arg === '-h';
}

function isVersionFlag(arg: string | undefined): boolean {
  return arg === '--version' || arg === '-V';
}

function runCli(argv: string[]): void {
  import('./cli.ts').then(({ runCli }) => runCli(argv)).catch(handleStartupError);
}

function handleStartupError(error: unknown): void {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
