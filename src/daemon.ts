import { startDaemonRuntime } from './daemon-runtime.ts';
import { asAppError } from './utils/errors.ts';

void startDaemonRuntime().catch((error) => {
  const appErr = asAppError(error);
  process.stderr.write(`Daemon error: ${appErr.message}\n`);
  process.exit(1);
});
