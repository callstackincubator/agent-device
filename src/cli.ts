import { toDaemonFlags, usage, usageForCommand } from './utils/args.ts';
import { asAppError, AppError, normalizeError } from './utils/errors.ts';
import {
  formatSnapshotDiffText,
  formatSnapshotText,
  printHumanError,
  printJson,
} from './utils/output.ts';
import { readVersion } from './utils/version.ts';
import { readCommandMessage } from './utils/success-text.ts';
import { pathToFileURL } from 'node:url';
import { sendToDaemon } from './daemon-client.ts';
import fs from 'node:fs';
import type { BatchStep } from './core/dispatch.ts';
import { parseBatchStepsJson } from './core/batch.ts';
import { createAgentDeviceClient, type AgentDeviceClientConfig } from './client.ts';
import type { ReplaySuiteResult } from './daemon/types.ts';
import { tryRunClientBackedCommand } from './cli/commands/router.ts';
import { announceReplayTestRun, renderReplayTestResponse } from './cli-test.ts';
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
import { findXctestrun, resolveRunnerDerivedRoot } from './platforms/ios/runner-xctestrun.ts';

type CliDeps = {
  sendToDaemon: typeof sendToDaemon;
};

const DEFAULT_CLI_DEPS: CliDeps = {
  sendToDaemon,
};

const APPLE_RUNNER_BACKED_COMMANDS = new Set([
  'alert',
  'back',
  'click',
  'fill',
  'find',
  'get',
  'home',
  'is',
  'keyboard',
  'longpress',
  'press',
  'record',
  'scroll',
  'scrollintoview',
  'snapshot',
  'trace',
  'type',
  'wait',
]);
const APPLE_RUNNER_BUILD_NOTICE =
  'Preparing iOS automation runner (XCTest build). This can take 10-30s on first run...';
const APPLE_RUNNER_RESTART_NOTICE =
  'Restarting iOS automation runner (XCTest). This can take 10-30s while the runner reconnects...';

export async function runCli(argv: string[], deps: CliDeps = DEFAULT_CLI_DEPS): Promise<void> {
  const requestId = createRequestId();
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
        process.stdout.write(`${readVersion()}\n`);
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
      const daemonFlags = toDaemonFlags(flags);
      const daemonPaths = resolveDaemonPaths(flags.stateDir);
      const sessionName = flags.session ?? 'default';
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
      const sendDaemonRequest = async (payload: {
        command: string;
        positionals: string[];
        flags?: Record<string, unknown>;
      }) =>
        await deps.sendToDaemon({
          session: sessionName,
          command: payload.command,
          positionals: payload.positionals,
          flags: payload.flags as any,
          meta: {
            requestId,
            debug: Boolean(flags.verbose),
            cwd: process.cwd(),
            tenantId: flags.tenant,
            runId: flags.runId,
            leaseId: flags.leaseId,
            sessionIsolation: flags.sessionIsolation,
            lockPolicy: binding.lockPolicy,
            lockPlatform: binding.defaultPlatform,
          },
        });
      try {
        if (command === 'batch') {
          if (positionals.length > 0) {
            throw new AppError('INVALID_ARGS', 'batch does not accept positional arguments.');
          }
          const batchSteps = readBatchSteps(flags).map((step, _index) => ({
            ...step,
            flags:
              binding.lockPolicy && flags.platform === undefined
                ? { ...((step.flags ?? {}) as Partial<typeof daemonFlags>) }
                : applyDefaultPlatformBinding((step.flags ?? {}) as Partial<typeof daemonFlags>, {
                    policyOverrides: flags,
                    configuredPlatform: flags.platform,
                    configuredSession: flags.session,
                    inheritedPlatform: flags.platform,
                  }),
          }));
          const batchFlags = { ...daemonFlags, batchSteps };
          delete (batchFlags as Record<string, unknown>).steps;
          delete (batchFlags as Record<string, unknown>).stepsFile;

          const response = await sendDaemonRequest({
            command: 'batch',
            positionals,
            flags: batchFlags,
          });
          if (!response.ok) {
            throw new AppError(response.error.code as any, response.error.message, {
              ...(response.error.details ?? {}),
              hint: response.error.hint,
              diagnosticId: response.error.diagnosticId,
              logPath: response.error.logPath,
            });
          }
          if (flags.json) {
            printJson({ success: true, data: response.data ?? {} });
          } else {
            renderBatchSummary(response.data ?? {});
          }
          if (logTailStopper) logTailStopper();
          return;
        }

        if (command === 'runtime') {
          throw new AppError(
            'INVALID_ARGS',
            'runtime command was removed. Use open --remote-config <path> --relaunch for remote Metro launches, or metro prepare --remote-config <path> for inspection.',
          );
        }

        await maybeAnnounceAppleRunnerStartup({
          command,
          flags,
          daemonFlags,
          sessionName,
          requestId,
          debug: Boolean(flags.verbose),
          remoteDaemonBaseUrl,
          sendToDaemon: deps.sendToDaemon,
        });

        if (await tryRunClientBackedCommand({ command, positionals, flags, client })) {
          if (logTailStopper) logTailStopper();
          return;
        }

        if (command === 'test') {
          announceReplayTestRun({ json: flags.json });
        }

        const response = await sendDaemonRequest({
          command: command!,
          positionals,
          flags: daemonFlags,
        });

        if (response.ok) {
          if (flags.json) {
            if (command === 'test') {
              const testExitCode = renderReplayTestResponse({
                suite: (response.data ?? {}) as ReplaySuiteResult,
                json: true,
                reportJunit: flags.reportJunit,
              });
              if (logTailStopper) logTailStopper();
              if (testExitCode !== 0) {
                process.exit(testExitCode);
              }
              return;
            }
            printJson({ success: true, data: response.data ?? {} });
            if (logTailStopper) logTailStopper();
            return;
          }
          if (command === 'snapshot') {
            process.stdout.write(
              formatSnapshotText((response.data ?? {}) as Record<string, unknown>, {
                raw: flags.snapshotRaw,
                flatten: flags.snapshotInteractiveOnly,
              }),
            );
            if (logTailStopper) logTailStopper();
            return;
          }
          if (command === 'test') {
            const testExitCode = renderReplayTestResponse({
              suite: (response.data ?? {}) as ReplaySuiteResult,
              verbose: flags.verbose,
              reportJunit: flags.reportJunit,
            });
            if (logTailStopper) logTailStopper();
            if (testExitCode !== 0) {
              process.exit(testExitCode);
            }
            return;
          }
          if (command === 'diff' && positionals[0] === 'snapshot') {
            process.stdout.write(
              formatSnapshotDiffText((response.data ?? {}) as Record<string, unknown>),
            );
            if (logTailStopper) logTailStopper();
            return;
          }
          if (command === 'get') {
            const sub = positionals[0];
            if (sub === 'text') {
              const text = (response.data as any)?.text ?? '';
              process.stdout.write(`${text}\n`);
              if (logTailStopper) logTailStopper();
              return;
            }
            if (sub === 'attrs') {
              const node = (response.data as any)?.node ?? {};
              process.stdout.write(`${JSON.stringify(node, null, 2)}\n`);
              if (logTailStopper) logTailStopper();
              return;
            }
          }
          if (command === 'find') {
            const data = response.data as any;
            if (typeof data?.text === 'string') {
              process.stdout.write(`${data.text}\n`);
              if (logTailStopper) logTailStopper();
              return;
            }
            if (typeof data?.found === 'boolean') {
              process.stdout.write(`Found: ${data.found}\n`);
              if (logTailStopper) logTailStopper();
              return;
            }
            if (data?.node) {
              process.stdout.write(`${JSON.stringify(data.node, null, 2)}\n`);
              if (logTailStopper) logTailStopper();
              return;
            }
          }
          if (command === 'is') {
            const predicate = (response.data as any)?.predicate ?? 'assertion';
            process.stdout.write(`Passed: is ${predicate}\n`);
            if (logTailStopper) logTailStopper();
            return;
          }
          if (command === 'boot') {
            const platform = (response.data as any)?.platform ?? 'unknown';
            const device =
              (response.data as any)?.device ?? (response.data as any)?.id ?? 'unknown';
            process.stdout.write(`Boot ready: ${device} (${platform})\n`);
            if (logTailStopper) logTailStopper();
            return;
          }
          if (command === 'ensure-simulator') {
            const data = response.data as Record<string, unknown> | undefined;
            const udid = typeof data?.udid === 'string' ? data.udid : 'unknown';
            const device = typeof data?.device === 'string' ? data.device : 'unknown';
            const runtime = typeof data?.runtime === 'string' ? data.runtime : '';
            const created = data?.created === true;
            const booted = data?.booted === true;
            const action = created ? 'Created' : 'Reused';
            const bootedSuffix = booted ? ' (booted)' : '';
            process.stdout.write(`${action}: ${device} ${udid}${bootedSuffix}\n`);
            if (runtime) process.stdout.write(`Runtime: ${runtime}\n`);
            if (logTailStopper) logTailStopper();
            return;
          }
          if (command === 'screenshot') {
            const pathOut =
              typeof (response.data as any)?.path === 'string' ? (response.data as any).path : '';
            if (pathOut) {
              process.stdout.write(`${pathOut}\n`);
            }
            if (logTailStopper) logTailStopper();
            return;
          }
          if (command === 'record') {
            const data = response.data as Record<string, unknown> | undefined;
            const outPath = typeof data?.outPath === 'string' ? data.outPath : '';
            if (outPath) process.stdout.write(`${outPath}\n`);
            if (logTailStopper) logTailStopper();
            return;
          }
          if (command === 'logs') {
            const data = response.data as Record<string, unknown> | undefined;
            const pathOut = typeof data?.path === 'string' ? data.path : '';
            if (pathOut) {
              process.stdout.write(`${pathOut}\n`);
              const active = typeof data?.active === 'boolean' ? data.active : undefined;
              const state = typeof data?.state === 'string' ? data.state : undefined;
              const backend = typeof data?.backend === 'string' ? data.backend : undefined;
              const sizeBytes = typeof data?.sizeBytes === 'number' ? data.sizeBytes : undefined;
              const started = data?.started === true;
              const stopped = data?.stopped === true;
              const marked = data?.marked === true;
              const cleared = data?.cleared === true;
              const restarted = data?.restarted === true;
              const removedRotatedFiles =
                typeof data?.removedRotatedFiles === 'number'
                  ? data.removedRotatedFiles
                  : undefined;
              if (
                !flags.json &&
                (active !== undefined || state || backend || sizeBytes !== undefined)
              ) {
                const meta = [
                  active !== undefined ? `active=${active}` : '',
                  state ? `state=${state}` : '',
                  backend ? `backend=${backend}` : '',
                  sizeBytes !== undefined ? `sizeBytes=${sizeBytes}` : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                if (meta) process.stderr.write(`${meta}\n`);
              }
              if (
                !flags.json &&
                (started ||
                  stopped ||
                  marked ||
                  cleared ||
                  restarted ||
                  removedRotatedFiles !== undefined)
              ) {
                const actionMeta = [
                  started ? 'started=true' : '',
                  stopped ? 'stopped=true' : '',
                  marked ? 'marked=true' : '',
                  cleared ? 'cleared=true' : '',
                  restarted ? 'restarted=true' : '',
                  removedRotatedFiles !== undefined
                    ? `removedRotatedFiles=${removedRotatedFiles}`
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                if (actionMeta) process.stderr.write(`${actionMeta}\n`);
              }
              if (data?.hint && !flags.json) {
                process.stderr.write(`${data.hint}\n`);
              }
              if (Array.isArray(data?.notes) && !flags.json) {
                for (const note of data.notes) {
                  if (typeof note === 'string' && note.length > 0) {
                    process.stderr.write(`${note}\n`);
                  }
                }
              }
            }
            if (logTailStopper) logTailStopper();
            return;
          }
          if (command === 'clipboard') {
            const data = response.data as Record<string, unknown> | undefined;
            const action = (
              positionals[0] ?? (typeof data?.action === 'string' ? data.action : '')
            ).toLowerCase();
            if (action === 'read') {
              const text = typeof data?.text === 'string' ? data.text : '';
              process.stdout.write(`${text}\n`);
              if (logTailStopper) logTailStopper();
              return;
            }
            if (action === 'write') {
              process.stdout.write('Clipboard updated\n');
              if (logTailStopper) logTailStopper();
              return;
            }
          }
          if (command === 'network') {
            const data = response.data as Record<string, unknown> | undefined;
            const pathOut = typeof data?.path === 'string' ? data.path : '';
            if (pathOut) {
              process.stdout.write(`${pathOut}\n`);
            }
            const entries = Array.isArray(data?.entries) ? data.entries : [];
            if (entries.length === 0) {
              process.stdout.write('No recent HTTP(s) entries found.\n');
            } else {
              for (const entry of entries as Array<Record<string, unknown>>) {
                const method = typeof entry.method === 'string' ? entry.method : 'HTTP';
                const url = typeof entry.url === 'string' ? entry.url : '<unknown-url>';
                const status = typeof entry.status === 'number' ? ` status=${entry.status}` : '';
                const timestamp = typeof entry.timestamp === 'string' ? `${entry.timestamp} ` : '';
                process.stdout.write(`${timestamp}${method} ${url}${status}\n`);
                if (typeof entry.headers === 'string') {
                  process.stdout.write(`  headers: ${entry.headers}\n`);
                }
                if (typeof entry.requestBody === 'string') {
                  process.stdout.write(`  request: ${entry.requestBody}\n`);
                }
                if (typeof entry.responseBody === 'string') {
                  process.stdout.write(`  response: ${entry.responseBody}\n`);
                }
              }
            }
            const active = typeof data?.active === 'boolean' ? data.active : undefined;
            const state = typeof data?.state === 'string' ? data.state : undefined;
            const backend = typeof data?.backend === 'string' ? data.backend : undefined;
            const scannedLines =
              typeof data?.scannedLines === 'number' ? data.scannedLines : undefined;
            const matchedLines =
              typeof data?.matchedLines === 'number' ? data.matchedLines : undefined;
            const include = typeof data?.include === 'string' ? data.include : undefined;
            const meta = [
              active !== undefined ? `active=${active}` : '',
              state ? `state=${state}` : '',
              backend ? `backend=${backend}` : '',
              include ? `include=${include}` : '',
              scannedLines !== undefined ? `scannedLines=${scannedLines}` : '',
              matchedLines !== undefined ? `matchedLines=${matchedLines}` : '',
            ]
              .filter(Boolean)
              .join(' ');
            if (meta) process.stderr.write(`${meta}\n`);
            if (Array.isArray(data?.notes)) {
              for (const note of data.notes) {
                if (typeof note === 'string' && note.length > 0) {
                  process.stderr.write(`${note}\n`);
                }
              }
            }
            if (logTailStopper) logTailStopper();
            return;
          }
          if (command === 'click' || command === 'press') {
            const ref = (response.data as any)?.ref ?? '';
            const x = (response.data as any)?.x;
            const y = (response.data as any)?.y;
            if (ref && typeof x === 'number' && typeof y === 'number') {
              process.stdout.write(`Tapped @${ref} (${x}, ${y})\n`);
              if (logTailStopper) logTailStopper();
              return;
            }
          }
          if (response.data && typeof response.data === 'object') {
            const data = response.data as Record<string, unknown>;
            if (command === 'devices') {
              const devices = Array.isArray((data as any).devices) ? (data as any).devices : [];
              const lines = devices.map((d: any) => {
                const name = d?.name ?? d?.id ?? 'unknown';
                const platform = d?.platform ?? 'unknown';
                const kind = d?.kind ? ` ${d.kind}` : '';
                const target = d?.target ? ` target=${d.target}` : '';
                const booted = typeof d?.booted === 'boolean' ? ` booted=${d.booted}` : '';
                return `${name} (${platform}${kind}${target})${booted}`;
              });
              process.stdout.write(`${lines.join('\n')}\n`);
              if (logTailStopper) logTailStopper();
              return;
            }
            if (command === 'apps') {
              const apps = Array.isArray((data as any).apps) ? (data as any).apps : [];
              const lines = apps.map((app: any) => {
                if (typeof app === 'string') return app;
                if (app && typeof app === 'object') {
                  const bundleId = app.bundleId ?? app.package;
                  const name = app.name ?? app.label;
                  if (name && bundleId) return `${name} (${bundleId})`;
                  if (bundleId) return String(bundleId);
                  return JSON.stringify(app);
                }
                return String(app);
              });
              process.stdout.write(`${lines.join('\n')}\n`);
              if (logTailStopper) logTailStopper();
              return;
            }
            if (command === 'appstate') {
              const platform = (data as any)?.platform;
              const appBundleId = (data as any)?.appBundleId;
              const appName = (data as any)?.appName;
              const source = (data as any)?.source;
              const pkg = (data as any)?.package;
              const activity = (data as any)?.activity;
              if (platform === 'ios') {
                process.stdout.write(`Foreground app: ${appName ?? appBundleId ?? 'unknown'}\n`);
                if (appBundleId) process.stdout.write(`Bundle: ${appBundleId}\n`);
                if (source) process.stdout.write(`Source: ${source}\n`);
                if (logTailStopper) logTailStopper();
                return;
              }
              if (platform === 'android') {
                process.stdout.write(`Foreground app: ${pkg ?? 'unknown'}\n`);
                if (activity) process.stdout.write(`Activity: ${activity}\n`);
                if (logTailStopper) logTailStopper();
                return;
              }
            }
            if (command === 'perf') {
              process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
              if (logTailStopper) logTailStopper();
              return;
            }
            const successText = readCommandMessage(data);
            if (successText) {
              process.stdout.write(`${successText}\n`);
              if (logTailStopper) logTailStopper();
              return;
            }
          }
          if (logTailStopper) logTailStopper();
          return;
        }

        throw new AppError(response.error.code as any, response.error.message, {
          ...(response.error.details ?? {}),
          hint: response.error.hint,
          diagnosticId: response.error.diagnosticId,
          logPath: response.error.logPath,
        });
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
          if (logTailStopper) logTailStopper();
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
      }
    },
  );
}

async function maybeAnnounceAppleRunnerStartup(params: {
  command: string;
  flags: ReturnType<typeof resolveCliOptions>['flags'];
  daemonFlags: Record<string, unknown>;
  sessionName: string;
  requestId: string;
  debug: boolean;
  remoteDaemonBaseUrl?: string;
  sendToDaemon: typeof sendToDaemon;
}): Promise<void> {
  const { command, flags, daemonFlags, sessionName, requestId, debug, remoteDaemonBaseUrl } =
    params;
  if (flags.json || remoteDaemonBaseUrl || !APPLE_RUNNER_BACKED_COMMANDS.has(command)) {
    return;
  }

  const platform = await resolveAppleRunnerNoticePlatform({
    flags,
    daemonFlags,
    sessionName,
    requestId,
    debug,
    sendToDaemon: params.sendToDaemon,
  });
  if (platform !== 'ios' && platform !== 'macos') {
    return;
  }

  const notice =
    findXctestrun(resolveRunnerDerivedRoot()) === null
      ? APPLE_RUNNER_BUILD_NOTICE
      : APPLE_RUNNER_RESTART_NOTICE;
  process.stdout.write(`${notice}\n`);
}

async function resolveAppleRunnerNoticePlatform(params: {
  flags: ReturnType<typeof resolveCliOptions>['flags'];
  daemonFlags: Record<string, unknown>;
  sessionName: string;
  requestId: string;
  debug: boolean;
  sendToDaemon: typeof sendToDaemon;
}): Promise<string | null> {
  const explicitPlatform = params.flags.platform;
  if (typeof explicitPlatform === 'string' && explicitPlatform.length > 0) {
    return explicitPlatform;
  }

  try {
    const response = await params.sendToDaemon({
      session: params.sessionName,
      command: 'session_list',
      positionals: [],
      flags: params.daemonFlags as any,
      meta: {
        requestId: `${params.requestId}:runner-preflight`,
        debug: params.debug,
        cwd: process.cwd(),
      },
    });
    if (!response.ok) {
      return null;
    }
    const sessions = Array.isArray((response.data as Record<string, unknown> | undefined)?.sessions)
      ? (((response.data as Record<string, unknown>).sessions as unknown[]) ?? [])
      : [];
    const matchingSession = sessions.find((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      return (entry as { name?: unknown }).name === params.sessionName;
    }) as { platform?: unknown } | undefined;
    return typeof matchingSession?.platform === 'string' ? matchingSession.platform : null;
  } catch {
    return null;
  }
}

function renderBatchSummary(data: Record<string, unknown>): void {
  const total = typeof data.total === 'number' ? data.total : 0;
  const executed = typeof data.executed === 'number' ? data.executed : 0;
  const durationMs = typeof data.totalDurationMs === 'number' ? data.totalDurationMs : undefined;
  process.stdout.write(
    `Batch completed: ${executed}/${total} steps${durationMs !== undefined ? ` in ${durationMs}ms` : ''}\n`,
  );
  const results = Array.isArray(data.results) ? data.results : [];
  for (const entry of results) {
    if (!entry || typeof entry !== 'object') continue;
    const result = entry as Record<string, unknown>;
    const step = typeof result.step === 'number' ? result.step : undefined;
    const command = typeof result.command === 'string' ? result.command : 'step';
    const stepOk = result.ok !== false;
    const stepDurationMs = typeof result.durationMs === 'number' ? result.durationMs : undefined;
    const stepData =
      result.data && typeof result.data === 'object'
        ? (result.data as Record<string, unknown>)
        : undefined;
    const stepError =
      result.error && typeof result.error === 'object'
        ? (result.error as Record<string, unknown>)
        : undefined;
    const description = stepOk
      ? (readCommandMessage(stepData) ?? command)
      : (readBatchStepFailure(stepError) ?? command);
    const prefix = step !== undefined ? `${step}. ` : '- ';
    const durationSuffix = stepDurationMs !== undefined ? ` (${stepDurationMs}ms)` : '';
    process.stdout.write(`${prefix}${stepOk ? 'OK' : 'FAILED'} ${description}${durationSuffix}\n`);
  }
}

function readBatchStepFailure(error: Record<string, unknown> | undefined): string | null {
  return typeof error?.message === 'string' && error.message.length > 0 ? error.message : null;
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
