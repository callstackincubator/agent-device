import fs from 'node:fs';
import path from 'node:path';
import { runCmd, runCmdBackground } from '../../utils/exec.ts';
import { resolveTargetDevice, type CommandFlags } from '../../core/dispatch.ts';
import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import {
  runIosRunnerCommand,
  IOS_RUNNER_CONTAINER_BUNDLE_IDS,
} from '../../platforms/ios/runner-client.ts';
import { buildSimctlArgsForDevice } from '../../platforms/ios/simctl.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { ensureDeviceReady } from '../device-ready.ts';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import type { DaemonArtifact } from '../types.ts';

const IOS_DEVICE_RECORD_MIN_FPS = 1;
const IOS_DEVICE_RECORD_MAX_FPS = 120;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRunnerRecordingAlreadyInProgressError(error: unknown): boolean {
  return errorMessage(error).toLowerCase().includes('recording already in progress');
}

function normalizeAppBundleId(session: SessionState): string | undefined {
  const trimmed = session.appBundleId?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function findOtherRunnerRecording(
  sessionStore: SessionStore,
  deviceId: string,
  currentSessionName: string,
): SessionState | undefined {
  return sessionStore
    .toArray()
    .find(
      (session) =>
        session.name !== currentSessionName &&
        session.device.id === deviceId &&
        (session.recording?.platform === 'ios-device-runner' ||
          session.recording?.platform === 'macos-runner'),
    );
}

function getRunnerOptions(req: DaemonRequest, logPath: string | undefined, session: SessionState) {
  return {
    verbose: req.flags?.verbose,
    logPath,
    traceLogPath: session.trace?.outPath,
  };
}

async function startRunnerRecordingSession(params: {
  deps: NonNullable<Parameters<typeof handleRecordTraceCommands>[0]['deps']>;
  device: SessionState['device'];
  sessionStore: SessionStore;
  session: SessionState;
  req: DaemonRequest;
  logPath: string | undefined;
  fps?: number;
  appBundleId: string;
  runnerOutPath: string;
  recording: Extract<
    NonNullable<SessionState['recording']>,
    { platform: 'ios-device-runner' | 'macos-runner' }
  >;
}): Promise<DaemonResponse | { recording: NonNullable<SessionState['recording']> }> {
  const { deps, device, sessionStore, session, req, logPath, fps, appBundleId, runnerOutPath } =
    params;
  const runnerOptions = getRunnerOptions(req, logPath, session);
  const startRunnerRecording = async () => {
    await deps.runIosRunnerCommand(
      device,
      {
        command: 'recordStart',
        outPath: runnerOutPath,
        fps,
        appBundleId,
      },
      runnerOptions,
    );
  };

  try {
    await startRunnerRecording();
  } catch (error) {
    if (isRunnerRecordingAlreadyInProgressError(error)) {
      emitDiagnostic({
        level: 'warn',
        phase: 'record_start_runner_desynced',
        data: {
          platform: device.platform,
          kind: device.kind,
          deviceId: device.id,
          session: session.name,
          error: errorMessage(error),
        },
      });
      const otherRecordingSession = findOtherRunnerRecording(sessionStore, device.id, session.name);
      if (otherRecordingSession) {
        return {
          ok: false,
          error: {
            code: 'COMMAND_FAILED',
            message: `failed to start recording: recording already in progress in session '${otherRecordingSession.name}'`,
          },
        };
      }
      try {
        await deps.runIosRunnerCommand(
          device,
          { command: 'recordStop', appBundleId },
          runnerOptions,
        );
      } catch {
        // best effort: stop stale runner recording and retry start
      }
      try {
        await startRunnerRecording();
      } catch (retryError) {
        return {
          ok: false,
          error: {
            code: 'COMMAND_FAILED',
            message: `failed to start recording: ${errorMessage(retryError)}`,
          },
        };
      }
    } else {
      return {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: `failed to start recording: ${errorMessage(error)}`,
        },
      };
    }
  }

  return { recording: params.recording };
}

export async function handleRecordTraceCommands(params: {
  req: DaemonRequest;
  sessionName: string;
  sessionStore: SessionStore;
  logPath?: string;
  deps?: {
    runCmd: typeof runCmd;
    runCmdBackground: typeof runCmdBackground;
    runIosRunnerCommand: typeof runIosRunnerCommand;
  };
}): Promise<DaemonResponse | null> {
  const { req, sessionName, sessionStore, logPath } = params;
  const deps = params.deps ?? { runCmd, runCmdBackground, runIosRunnerCommand };
  const command = req.command;

  if (command === 'record') {
    const action = (req.positionals?.[0] ?? '').toLowerCase();
    if (!['start', 'stop'].includes(action)) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'record requires start|stop' } };
    }
    const session = sessionStore.get(sessionName);
    const device = session?.device ?? (await resolveTargetDevice(req.flags ?? {}));
    if (!session) {
      await ensureDeviceReady(device);
    }
    const activeSession =
      session ??
      ({
        name: sessionName,
        device,
        createdAt: Date.now(),
        actions: [],
      } satisfies SessionState);

    if (action === 'start') {
      if (activeSession.recording) {
        return {
          ok: false,
          error: { code: 'INVALID_ARGS', message: 'recording already in progress' },
        };
      }
      const fpsFlag = req.flags?.fps;
      if (
        fpsFlag !== undefined &&
        (!Number.isInteger(fpsFlag) ||
          fpsFlag < IOS_DEVICE_RECORD_MIN_FPS ||
          fpsFlag > IOS_DEVICE_RECORD_MAX_FPS)
      ) {
        return {
          ok: false,
          error: {
            code: 'INVALID_ARGS',
            message: `fps must be an integer between ${IOS_DEVICE_RECORD_MIN_FPS} and ${IOS_DEVICE_RECORD_MAX_FPS}`,
          },
        };
      }
      const outPath = req.positionals?.[1] ?? `./recording-${Date.now()}.mp4`;
      if (!isCommandSupportedOnDevice('record', device)) {
        return {
          ok: false,
          error: {
            code: 'UNSUPPORTED_OPERATION',
            message: 'record is not supported on this device',
          },
        };
      }
      const runnerAppBundleId =
        (device.platform === 'ios' && device.kind === 'device') || device.platform === 'macos'
          ? normalizeAppBundleId(activeSession)
          : undefined;
      if (
        !runnerAppBundleId &&
        ((device.platform === 'ios' && device.kind === 'device') || device.platform === 'macos')
      ) {
        return {
          ok: false,
          error: {
            code: 'INVALID_ARGS',
            message:
              device.platform === 'macos'
                ? 'record on macOS requires an active app session; run open <app> first'
                : 'record on physical iOS devices requires an active app session; run open <app> first',
          },
        };
      }
      const ensuredRunnerAppBundleId = runnerAppBundleId as string;
      const resolvedOut = SessionStore.expandHome(outPath, req.meta?.cwd);
      const clientOutPath = req.meta?.clientArtifactPaths?.outPath;
      fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
      if (device.platform === 'ios' && device.kind === 'device') {
        const appBundleId = ensuredRunnerAppBundleId;
        const recordingFileName = `agent-device-recording-${Date.now()}.mp4`;
        const remotePath = `tmp/${recordingFileName}`;
        const started = await startRunnerRecordingSession({
          deps,
          device,
          sessionStore,
          session: activeSession,
          req,
          logPath,
          fps: fpsFlag,
          appBundleId,
          runnerOutPath: recordingFileName,
          recording: {
            platform: 'ios-device-runner',
            outPath: resolvedOut,
            clientOutPath,
            remotePath,
          },
        });
        if ('ok' in started) {
          return started;
        }
        activeSession.recording = started.recording;
      } else if (device.platform === 'macos') {
        const appBundleId = ensuredRunnerAppBundleId;
        const started = await startRunnerRecordingSession({
          deps,
          device,
          sessionStore,
          session: activeSession,
          req,
          logPath,
          fps: fpsFlag,
          appBundleId,
          runnerOutPath: resolvedOut,
          recording: {
            platform: 'macos-runner',
            outPath: resolvedOut,
            clientOutPath,
          },
        });
        if ('ok' in started) {
          return started;
        }
        activeSession.recording = started.recording;
      } else if (device.platform === 'ios') {
        const { child, wait } = deps.runCmdBackground(
          'xcrun',
          buildSimctlArgsForDevice(device, ['io', device.id, 'recordVideo', resolvedOut]),
          {
            allowFailure: true,
          },
        );
        activeSession.recording = {
          platform: 'ios',
          outPath: resolvedOut,
          clientOutPath,
          child,
          wait,
        };
      } else {
        const remotePath = `/sdcard/agent-device-recording-${Date.now()}.mp4`;
        const { child, wait } = deps.runCmdBackground(
          'adb',
          ['-s', device.id, 'shell', 'screenrecord', remotePath],
          {
            allowFailure: true,
          },
        );
        activeSession.recording = {
          platform: 'android',
          outPath: resolvedOut,
          clientOutPath,
          remotePath,
          child,
          wait,
        };
      }
      sessionStore.set(sessionName, activeSession);
      sessionStore.recordAction(activeSession, {
        command,
        positionals: req.positionals ?? [],
        flags: (req.flags ?? {}) as CommandFlags,
        result: { action: 'start' },
      });
      return { ok: true, data: { recording: 'started', outPath: clientOutPath ?? outPath } };
    }

    if (!activeSession.recording) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'no active recording' } };
    }
    const recording = activeSession.recording;
    if (recording.platform === 'ios-device-runner' || recording.platform === 'macos-runner') {
      const appBundleId = normalizeAppBundleId(activeSession);
      try {
        await deps.runIosRunnerCommand(
          device,
          { command: 'recordStop', appBundleId },
          getRunnerOptions(req, logPath, activeSession),
        );
      } catch (error) {
        emitDiagnostic({
          level: 'warn',
          phase: 'record_stop_runner_failed',
          data: {
            platform: device.platform,
            kind: device.kind,
            deviceId: device.id,
            session: activeSession.name,
            error: errorMessage(error),
          },
        });
        // best effort: clear runner-backed recording state even if runner stop fails
      }
      activeSession.recording = undefined;
      if (recording.platform === 'ios-device-runner') {
        let copyResult = { stdout: '', stderr: '', exitCode: 1 };
        for (const bundleId of IOS_RUNNER_CONTAINER_BUNDLE_IDS) {
          copyResult = await deps.runCmd(
            'xcrun',
            [
              'devicectl',
              'device',
              'copy',
              'from',
              '--device',
              device.id,
              '--source',
              recording.remotePath as string,
              '--destination',
              recording.outPath,
              '--domain-type',
              'appDataContainer',
              '--domain-identifier',
              bundleId,
            ],
            { allowFailure: true },
          );
          if (copyResult.exitCode === 0) {
            break;
          }
        }
        if (copyResult.exitCode !== 0) {
          const copyError =
            copyResult.stderr.trim() ||
            copyResult.stdout.trim() ||
            `devicectl exited with code ${copyResult.exitCode}`;
          return {
            ok: false,
            error: {
              code: 'COMMAND_FAILED',
              message: `failed to copy recording from device: ${copyError}`,
            },
          };
        }
      }
    } else if ('child' in recording) {
      recording.child.kill('SIGINT');
      try {
        await recording.wait;
      } catch {
        // ignore
      }
      if (recording.platform === 'android' && recording.remotePath) {
        try {
          await deps.runCmd(
            'adb',
            ['-s', device.id, 'pull', recording.remotePath, recording.outPath],
            { allowFailure: true },
          );
          await deps.runCmd('adb', ['-s', device.id, 'shell', 'rm', '-f', recording.remotePath], {
            allowFailure: true,
          });
        } catch {
          // ignore
        }
      }
      activeSession.recording = undefined;
    }
    sessionStore.recordAction(activeSession, {
      command,
      positionals: req.positionals ?? [],
      flags: (req.flags ?? {}) as CommandFlags,
      result: { action: 'stop', outPath: recording.outPath },
    });
    const artifacts: DaemonArtifact[] = [
      {
        field: 'outPath',
        path: recording.outPath,
        localPath: recording.clientOutPath,
        fileName: path.basename(recording.clientOutPath ?? recording.outPath),
      },
    ];
    return { ok: true, data: { recording: 'stopped', outPath: recording.outPath, artifacts } };
  }

  if (command === 'trace') {
    const action = (req.positionals?.[0] ?? '').toLowerCase();
    if (!['start', 'stop'].includes(action)) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'trace requires start|stop' } };
    }
    const session = sessionStore.get(sessionName);
    if (!session) {
      return { ok: false, error: { code: 'SESSION_NOT_FOUND', message: 'No active session' } };
    }
    if (action === 'start') {
      if (session.trace) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'trace already in progress' } };
      }
      const outPath = req.positionals?.[1] ?? sessionStore.defaultTracePath(session);
      const resolvedOut = SessionStore.expandHome(outPath);
      fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
      fs.appendFileSync(resolvedOut, '');
      session.trace = { outPath: resolvedOut, startedAt: Date.now() };
      sessionStore.recordAction(session, {
        command,
        positionals: req.positionals ?? [],
        flags: (req.flags ?? {}) as CommandFlags,
        result: { action: 'start', outPath: resolvedOut },
      });
      return { ok: true, data: { trace: 'started', outPath: resolvedOut } };
    }
    if (!session.trace) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'no active trace' } };
    }
    let outPath = session.trace.outPath;
    if (req.positionals?.[1]) {
      const resolvedOut = SessionStore.expandHome(req.positionals[1]);
      fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
      if (fs.existsSync(outPath)) {
        fs.renameSync(outPath, resolvedOut);
      } else {
        fs.appendFileSync(resolvedOut, '');
      }
      outPath = resolvedOut;
    }
    session.trace = undefined;
    sessionStore.recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: (req.flags ?? {}) as CommandFlags,
      result: { action: 'stop', outPath },
    });
    return { ok: true, data: { trace: 'stopped', outPath } };
  }

  return null;
}
