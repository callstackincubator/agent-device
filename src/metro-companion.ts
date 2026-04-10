import { runMetroCompanionProcessFromEnv } from './client-metro-companion-worker.ts';

void runMetroCompanionProcessFromEnv(process.argv.slice(2), process.env).catch((error) => {
  if (error instanceof Error && error.message.includes('missing required environment')) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
