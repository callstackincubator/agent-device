import { runCmdSync } from './exec.ts';

const PS_TIMEOUT_MS = 1_000;
const DAEMON_COMMAND_PATTERNS = [
  /(^|[\/\s"'=])dist\/src\/daemon\.js($|[\s"'])/,
  /(^|[\/\s"'=])src\/daemon\.ts($|[\s"'])/,
];

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readProcessStartTime(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const result = runCmdSync('ps', ['-p', String(pid), '-o', 'lstart='], {
      allowFailure: true,
      timeoutMs: PS_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) return null;
    const value = result.stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function readProcessCommand(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const result = runCmdSync('ps', ['-p', String(pid), '-o', 'command='], {
      allowFailure: true,
      timeoutMs: PS_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) return null;
    const value = result.stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function isAgentDeviceDaemonCommand(command: string): boolean {
  const normalized = command.toLowerCase().replaceAll('\\', '/');
  if (!normalized.includes('agent-device')) return false;
  return DAEMON_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isAgentDeviceDaemonProcess(pid: number, expectedStartTime?: string): boolean {
  if (!isProcessAlive(pid)) return false;
  if (expectedStartTime) {
    const actualStartTime = readProcessStartTime(pid);
    if (!actualStartTime || actualStartTime !== expectedStartTime) return false;
  }
  const command = readProcessCommand(pid);
  if (!command) return false;
  return isAgentDeviceDaemonCommand(command);
}

function trySignalProcess(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH' || code === 'EPERM') return false;
    throw err;
  }
}

export async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  if (!isProcessAlive(pid)) return true;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (!isProcessAlive(pid)) return true;
  }
  return !isProcessAlive(pid);
}

export async function stopProcessForTakeover(
  pid: number,
  options: {
    termTimeoutMs: number;
    killTimeoutMs: number;
    expectedStartTime?: string;
  },
): Promise<void> {
  if (!isAgentDeviceDaemonProcess(pid, options.expectedStartTime)) return;
  if (!trySignalProcess(pid, 'SIGTERM')) return;
  if (await waitForProcessExit(pid, options.termTimeoutMs)) return;
  if (!trySignalProcess(pid, 'SIGKILL')) return;
  await waitForProcessExit(pid, options.killTimeoutMs);
}
