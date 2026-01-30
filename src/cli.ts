import { parseArgs, usage } from './utils/args.ts';
import { asAppError, AppError } from './utils/errors.ts';
import { printHumanError, printJson } from './utils/output.ts';
import { pathToFileURL } from 'node:url';
import { sendToDaemon } from './daemon-client.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function runCli(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);

  if (parsed.flags.help || !parsed.command) {
    process.stdout.write(`${usage()}\n`);
    process.exit(parsed.flags.help ? 0 : 1);
  }

  const { command, positionals, flags } = parsed;
  const sessionName = flags.session ?? process.env.AGENT_DEVICE_SESSION ?? 'default';
  const logTailStopper = flags.verbose && !flags.json ? startDaemonLogTail() : null;
  try {
    if (command === 'session') {
      const sub = positionals[0] ?? 'list';
      if (sub !== 'list') {
        throw new AppError('INVALID_ARGS', 'session only supports list');
      }
      const response = await sendToDaemon({
        session: sessionName,
        command: 'session_list',
        positionals: [],
        flags: {},
      });
      if (!response.ok) throw new AppError(response.error.code as any, response.error.message);
      if (flags.json) printJson({ success: true, data: response.data ?? {} });
      else process.stdout.write(`${JSON.stringify(response.data ?? {}, null, 2)}\n`);
      if (logTailStopper) logTailStopper();
      return;
    }

    const response = await sendToDaemon({
      session: sessionName,
      command: command!,
      positionals,
      flags,
    });

    if (response.ok) {
      if (flags.json) printJson({ success: true, data: response.data ?? {} });
      if (logTailStopper) logTailStopper();
      return;
    }

    throw new AppError(response.error.code as any, response.error.message, response.error.details);
  } catch (err) {
    const appErr = asAppError(err);
    if (flags.json) {
      printJson({
        success: false,
        error: { code: appErr.code, message: appErr.message, details: appErr.details },
      });
    } else {
      printHumanError(appErr);
      if (flags.verbose) {
        try {
          const fs = await import('node:fs');
          const os = await import('node:os');
          const path = await import('node:path');
          const logPath = path.join(os.homedir(), '.agent-device', 'daemon.log');
          if (fs.existsSync(logPath)) {
            const content = fs.readFileSync(logPath, 'utf8');
            const lines = content.split('\n');
            const tail = lines.slice(Math.max(0, lines.length - 200)).join('\n');
            if (tail.trim().length > 0) {
              process.stderr.write(`\n[daemon log]\n${tail}\n`);
            }
          }
        } catch {
          // ignore
        }
      }
    }
    if (logTailStopper) logTailStopper();
    process.exit(1);
  }
}

const isDirectRun = pathToFileURL(process.argv[1] ?? '').href === import.meta.url;
if (isDirectRun) {
  runCli(process.argv.slice(2)).catch((err) => {
    const appErr = asAppError(err);
    printHumanError(appErr);
    process.exit(1);
  });
}

function startDaemonLogTail(): (() => void) | null {
  try {
    const logPath = path.join(os.homedir(), '.agent-device', 'daemon.log');
    let offset = 0;
    let stopped = false;
    const interval = setInterval(() => {
      if (stopped) return;
      if (!fs.existsSync(logPath)) return;
      const stats = fs.statSync(logPath);
      if (stats.size <= offset) return;
      const fd = fs.openSync(logPath, 'r');
      const buffer = Buffer.alloc(stats.size - offset);
      fs.readSync(fd, buffer, 0, buffer.length, offset);
      fs.closeSync(fd);
      offset = stats.size;
      if (buffer.length > 0) {
        process.stdout.write(buffer.toString('utf8'));
      }
    }, 200);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  } catch {
    return null;
  }
}
