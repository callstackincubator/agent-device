import fs from 'node:fs';
import { resolveDaemonPaths } from '../src/daemon/config.ts';
import { stopProcessForTakeover } from '../src/utils/process-identity.ts';

const DAEMON_TERM_TIMEOUT_MS = 15_000;
const DAEMON_KILL_TIMEOUT_MS = 2_000;

type DaemonInfo = {
  pid?: number;
  processStartTime?: string;
};

const paths = resolveDaemonPaths(process.env.AGENT_DEVICE_STATE_DIR);
const info = readDaemonInfo(paths.infoPath);

if (info?.pid && Number.isInteger(info.pid) && info.pid > 0) {
  await stopProcessForTakeover(info.pid, {
    termTimeoutMs: DAEMON_TERM_TIMEOUT_MS,
    killTimeoutMs: DAEMON_KILL_TIMEOUT_MS,
    expectedStartTime: info.processStartTime,
  });
}

removeIfPresent(paths.infoPath);
removeIfPresent(paths.lockPath);

function readDaemonInfo(infoPath: string): DaemonInfo | null {
  try {
    return JSON.parse(fs.readFileSync(infoPath, 'utf8')) as DaemonInfo;
  } catch {
    return null;
  }
}

function removeIfPresent(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
