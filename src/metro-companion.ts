import { runCompanionTunnelProcessFromEnv } from './client-companion-tunnel-worker.ts';

void runCompanionTunnelProcessFromEnv(process.argv.slice(2), process.env).catch((error) => {
  if (error instanceof Error && error.message.includes('missing required environment')) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
