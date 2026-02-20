import fs from 'node:fs';
import path from 'node:path';
import { runCmd, runCmdBackground } from '../../utils/exec.ts';
import { resolveTargetDevice, type CommandFlags } from '../../core/dispatch.ts';
import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { runIosRunnerCommand } from '../../platforms/ios/runner-client.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { ensureDeviceReady } from '../device-ready.ts';

function getRunnerOptions(req: DaemonRequest, logPath: string | undefined, session: SessionState) {
  return {
    verbose: req.flags?.verbose,
    logPath,
    traceLogPath: session.trace?.outPath,
  };
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
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'recording already in progress' } };
      }
      const outPath = req.positionals?.[1] ?? `./recording-${Date.now()}.mp4`;
      const resolvedOut = path.resolve(outPath);
      const outDir = path.dirname(resolvedOut);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      if (!isCommandSupportedOnDevice('record', device)) {
        return {
          ok: false,
          error: { code: 'UNSUPPORTED_OPERATION', message: 'record is not supported on this device' },
        };
      }
      const runnerOptions = getRunnerOptions(req, logPath, activeSession);
      if (device.platform === 'ios' && device.kind === 'device') {
        try {
          await deps.runIosRunnerCommand(
            device,
            { command: 'recordStart', outPath: resolvedOut, appBundleId: activeSession.appBundleId },
            runnerOptions,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { ok: false, error: { code: 'COMMAND_FAILED', message: `failed to start recording: ${message}` } };
        }
        activeSession.recording = { platform: 'ios-device-runner', outPath: resolvedOut };
      } else if (device.platform === 'ios') {
        const { child, wait } = deps.runCmdBackground('xcrun', ['simctl', 'io', device.id, 'recordVideo', resolvedOut], {
          allowFailure: true,
        });
        activeSession.recording = { platform: 'ios', outPath: resolvedOut, child, wait };
      } else {
        const remotePath = `/sdcard/agent-device-recording-${Date.now()}.mp4`;
        const { child, wait } = deps.runCmdBackground('adb', ['-s', device.id, 'shell', 'screenrecord', remotePath], {
          allowFailure: true,
        });
        activeSession.recording = { platform: 'android', outPath: resolvedOut, remotePath, child, wait };
      }
      sessionStore.set(sessionName, activeSession);
      sessionStore.recordAction(activeSession, {
        command,
        positionals: req.positionals ?? [],
        flags: (req.flags ?? {}) as CommandFlags,
        result: { action: 'start' },
      });
      return { ok: true, data: { recording: 'started', outPath } };
    }

    if (!activeSession.recording) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'no active recording' } };
    }
    const recording = activeSession.recording;
    if (recording.platform === 'ios-device-runner') {
      try {
        await deps.runIosRunnerCommand(
          device,
          { command: 'recordStop', appBundleId: activeSession.appBundleId },
          getRunnerOptions(req, logPath, activeSession),
        );
      } catch {
        // best effort: clear runner-backed recording state even if runner stop fails
      }
    } else {
      recording.child.kill('SIGINT');
      try {
        await recording.wait;
      } catch {
        // ignore
      }
      if (recording.platform === 'android' && recording.remotePath) {
        try {
          await deps.runCmd('adb', ['-s', device.id, 'pull', recording.remotePath, recording.outPath], { allowFailure: true });
          await deps.runCmd('adb', ['-s', device.id, 'shell', 'rm', '-f', recording.remotePath], { allowFailure: true });
        } catch {
          // ignore
        }
      }
    }
    activeSession.recording = undefined;
    sessionStore.recordAction(activeSession, {
      command,
      positionals: req.positionals ?? [],
      flags: (req.flags ?? {}) as CommandFlags,
      result: { action: 'stop', outPath: recording.outPath },
    });
    return { ok: true, data: { recording: 'stopped', outPath: recording.outPath } };
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
