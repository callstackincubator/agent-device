const argv = process.argv.slice(2);

if (argv[0] === 'mcp' && !argv.includes('--help') && !argv.includes('-h')) {
  import('./mcp/server.ts')
    .then(({ runAgentDeviceMcpServer }) => runAgentDeviceMcpServer())
    .catch(handleStartupError);
} else {
  import('./cli.ts').then(({ runCli }) => runCli(argv)).catch(handleStartupError);
}

function handleStartupError(error: unknown): void {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
