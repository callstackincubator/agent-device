import { usage, usageForCommand } from './utils/args.ts';
import { asAppError, AppError, normalizeError } from './utils/errors.ts';
import { printHumanError, printJson } from './utils/output.ts';
import { readVersion } from './utils/version.ts';
import { pathToFileURL } from 'node:url';
import { sendToDaemon } from './daemon-client.ts';
import fs from 'node:fs';
import type { BatchStep } from './core/dispatch.ts';
import { parseBatchStepsJson } from './core/batch.ts';
import { createAgentDeviceClient, type AgentDeviceClientConfig } from './client.ts';
import { tryRunClientBackedCommand } from './cli/commands/router.ts';
import {
  createRequestId,
  emitDiagnostic,
  flushDiagnosticsToSessionFile,
  getDiagnosticsMeta,
  withDiagnosticsScope,
} from './utils/diagnostics.ts';
import { resolveDaemonPaths } from './daemon/config.ts';
import { applyDefaultPlatformBinding, resolveBindingSettings } from './utils/session-binding.ts';
import { resolveCliOptions } from './utils/cli-options.ts';
import { maybeRunUpgradeNotifier } from './utils/update-check.ts';

type CliDeps = {
  sendToDaemon: typeof sendToDaemon;
};

const DEFAULT_CLI_DEPS: CliDeps = {
  sendToDaemon,
};

export async function runCli(argv: string[], deps: CliDeps = DEFAULT_CLI_DEPS): Promise<void> {
  const requestId = createRequestId();
  const version = readVersion();
  const debugEnabled =
    argv.includes('--debug') || argv.includes('--verbose') || argv.includes('-v');
  const jsonRequested = argv.includes('--json');
  // Best-effort session guess used only for pre-parse diagnostics scope.
  // After parse succeeds, request dispatch uses parsed flags/session resolution.
  const sessionGuess = guessSessionFromArgv(argv) ?? process.env.AGENT_DEVICE_SESSION ?? 'default';

  await withDiagnosticsScope(
    {
      session: sessionGuess,
      requestId,
      command: argv[0],
      debug: debugEnabled,
    },
    async () => {
      let parsed: ReturnType<typeof resolveCliOptions>;
      try {
        parsed = resolveCliOptions(argv, { cwd: process.cwd(), env: process.env });
      } catch (error) {
        emitDiagnostic({
          level: 'error',
          phase: 'cli_parse_failed',
          data: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
        const normalized = normalizeError(error, {
          diagnosticId: getDiagnosticsMeta().diagnosticId,
          logPath: flushDiagnosticsToSessionFile({ force: true }) ?? undefined,
        });
        if (jsonRequested) {
          printJson({ success: false, error: normalized });
        } else {
          printHumanError(normalized, { showDetails: debugEnabled });
        }
        process.exit(1);
        return;
      }

      for (const warning of parsed.warnings) {
        process.stderr.write(`Warning: ${warning}\n`);
      }

      if (parsed.flags.version) {
        process.stdout.write(`${version}\n`);
        process.exit(0);
      }

      const isHelpAlias = parsed.command === 'help';
      const isHelpFlag = parsed.flags.help;
      if (isHelpAlias || isHelpFlag) {
        if (isHelpAlias && parsed.positionals.length > 1) {
          printHumanError(new AppError('INVALID_ARGS', 'help accepts at most one command.'));
          process.exit(1);
        }
        const helpTarget = isHelpAlias ? parsed.positionals[0] : parsed.command;
        if (!helpTarget) {
          process.stdout.write(`${usage()}\n`);
          process.exit(0);
        }
        const commandHelp = usageForCommand(helpTarget);
        if (commandHelp) {
          process.stdout.write(commandHelp);
          process.exit(0);
        }
        printHumanError(new AppError('INVALID_ARGS', `Unknown command: ${helpTarget}`));
        process.stdout.write(`${usage()}\n`);
        process.exit(1);
      }

      if (!parsed.command) {
        process.stdout.write(`${usage()}\n`);
        process.exit(1);
      }

      const { command, positionals } = parsed;
      const binding = resolveBindingSettings({
        policyOverrides: parsed.flags,
        configuredPlatform: parsed.flags.platform,
        configuredSession: parsed.flags.session,
      });
      const flags = binding.lockPolicy
        ? { ...parsed.flags }
        : applyDefaultPlatformBinding(parsed.flags, {
            policyOverrides: parsed.flags,
            configuredPlatform: parsed.flags.platform,
            configuredSession: parsed.flags.session,
          });
      const daemonPaths = resolveDaemonPaths(flags.stateDir);
      const sessionName = flags.session ?? 'default';
      maybeRunUpgradeNotifier({
        command,
        currentVersion: version,
        stateDir: daemonPaths.baseDir,
        flags,
      });
      const remoteDaemonBaseUrl = flags.daemonBaseUrl;
      const logTailStopper =
        flags.verbose && !flags.json && !remoteDaemonBaseUrl
          ? startDaemonLogTail(daemonPaths.logPath)
          : null;
      const clientConfig: AgentDeviceClientConfig = {
        session: sessionName,
        requestId,
        stateDir: flags.stateDir,
        daemonBaseUrl: flags.daemonBaseUrl,
        daemonAuthToken: flags.daemonAuthToken,
        daemonTransport: flags.daemonTransport,
        daemonServerMode: flags.daemonServerMode,
        remoteConfig: flags.remoteConfig,
        tenant: flags.tenant,
        sessionIsolation: flags.sessionIsolation,
        runId: flags.runId,
        leaseId: flags.leaseId,
        lockPolicy: binding.lockPolicy,
        lockPlatform: binding.defaultPlatform,
        cwd: process.cwd(),
        debug: Boolean(flags.verbose),
      };
      const client = createAgentDeviceClient(clientConfig, { transport: deps.sendToDaemon });
      try {
        if (command === 'batch') {
          if (positionals.length > 0) {
            throw new AppError('INVALID_ARGS', 'batch does not accept positional arguments.');
          }
          const batchSteps = readBatchSteps(flags).map((step, _index) => ({
            ...step,
            flags:
              binding.lockPolicy && flags.platform === undefined
                ? { ...((step.flags ?? {}) as Partial<typeof flags>) }
                : applyDefaultPlatformBinding((step.flags ?? {}) as Partial<typeof flags>, {
                    policyOverrides: flags,
                    configuredPlatform: flags.platform,
                    configuredSession: flags.session,
                    inheritedPlatform: flags.platform,
                  }),
          }));
          if (
            await tryRunClientBackedCommand({
              command,
              positionals,
              flags: { ...flags, batchSteps },
              client,
            })
          ) {
            return;
          }
        } else if (command === 'runtime') {
          throw new AppError(
            'INVALID_ARGS',
            'runtime command was removed. Use open --remote-config <path> --relaunch for remote Metro launches, or metro prepare --remote-config <path> for inspection.',
          );
        } else if (await tryRunClientBackedCommand({ command, positionals, flags, client })) {
          return;
        }

        throw new AppError('INVALID_ARGS', `Unknown command: ${command}`);
      } catch (err) {
        const appErr = asAppError(err);
        const normalized = normalizeError(appErr, {
          diagnosticId: getDiagnosticsMeta().diagnosticId,
          logPath: flushDiagnosticsToSessionFile({ force: true }) ?? undefined,
        });
        if (command === 'close' && isDaemonStartupFailure(appErr)) {
          if (flags.json) {
            printJson({ success: true, data: { closed: 'session', source: 'no-daemon' } });
          }
          return;
        }
        if (flags.json) {
          printJson({
            success: false,
            error: normalized,
          });
        } else {
          printHumanError(normalized, { showDetails: flags.verbose });
          if (flags.verbose) {
            try {
              const logPath = daemonPaths.logPath;
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
      } finally {
        if (logTailStopper) logTailStopper();
      }
    },
  );
}

function readBatchSteps(flags: ReturnType<typeof resolveCliOptions>['flags']): BatchStep[] {
  let raw = '';
  if (flags.steps) {
    raw = flags.steps;
  } else if (flags.stepsFile) {
    try {
      raw = fs.readFileSync(flags.stepsFile, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError(
        'INVALID_ARGS',
        `Failed to read --steps-file ${flags.stepsFile}: ${message}`,
      );
    }
  }
  return parseBatchStepsJson(raw);
}

function isDaemonStartupFailure(error: AppError): boolean {
  if (error.code !== 'COMMAND_FAILED') return false;
  if (error.details?.kind === 'daemon_startup_failed') return true;
  if (!error.message.toLowerCase().includes('failed to start daemon')) return false;
  return typeof error.details?.infoPath === 'string' || typeof error.details?.lockPath === 'string';
}

function guessSessionFromArgv(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--session=')) {
      const inline = token.slice('--session='.length).trim();
      return inline.length > 0 ? inline : null;
    }
    if (token === '--session') {
      const value = argv[i + 1]?.trim();
      if (value && !value.startsWith('-')) return value;
      return null;
    }
  }
  return null;
}

const isDirectRun = pathToFileURL(process.argv[1] ?? '').href === import.meta.url;
if (isDirectRun) {
  runCli(process.argv.slice(2)).catch((err) => {
    const appErr = asAppError(err);
    printHumanError(normalizeError(appErr), { showDetails: true });
    process.exit(1);
  });
}

function startDaemonLogTail(logPath: string): (() => void) | null {
  try {
    let offset = 0;
    let stopped = false;
    const interval = setInterval(() => {
      if (stopped) return;
      if (!fs.existsSync(logPath)) return;
      try {
        const stats = fs.statSync(logPath);
        if (stats.size < offset) offset = 0;
        if (stats.size <= offset) return;
        const fd = fs.openSync(logPath, 'r');
        try {
          const buffer = Buffer.alloc(stats.size - offset);
          fs.readSync(fd, buffer, 0, buffer.length, offset);
          offset = stats.size;
          if (buffer.length > 0) {
            process.stdout.write(buffer.toString('utf8'));
          }
        } finally {
          fs.closeSync(fd);
        }
      } catch {
        // Best-effort tailing should not crash CLI flow.
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
