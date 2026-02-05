import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dispatchCommand, resolveTargetDevice, type CommandFlags } from './core/dispatch.ts';
import { asAppError, AppError } from './utils/errors.ts';
import type { DeviceInfo } from './utils/device.ts';
import {
  attachRefs,
  centerOfRect,
  findNodeByRef,
  normalizeRef,
  type SnapshotState,
  type RawSnapshotNode,
} from './utils/snapshot.ts';
import { findNodeByLocator, type FindLocator } from './utils/finders.ts';
import { runIosRunnerCommand, stopIosRunnerSession } from './platforms/ios/runner-client.ts';
import { runCmd, runCmdBackground } from './utils/exec.ts';
import { snapshotAndroid } from './platforms/android/index.ts';

type DaemonRequest = {
  token: string;
  session: string;
  command: string;
  positionals: string[];
  flags?: CommandFlags;
};

type DaemonResponse =
  | { ok: true; data?: Record<string, unknown> }
  | { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } };

type SessionState = {
  name: string;
  device: DeviceInfo;
  createdAt: number;
  appBundleId?: string;
  appName?: string;
  snapshot?: SnapshotState;
  trace?: {
    outPath: string;
    startedAt: number;
  };
  actions: SessionAction[];
  recording?: {
    platform: 'ios' | 'android';
    outPath: string;
    remotePath?: string;
    child: ReturnType<typeof import('node:child_process').spawn>;
    wait: Promise<import('./utils/exec.ts').ExecResult>;
  };
};

type SessionAction = {
  ts: number;
  command: string;
  positionals: string[];
  flags: Partial<CommandFlags> & {
    snapshotInteractiveOnly?: boolean;
    snapshotCompact?: boolean;
    snapshotDepth?: number;
    snapshotScope?: string;
    snapshotRaw?: boolean;
    snapshotBackend?: 'ax' | 'xctest';
    noRecord?: boolean;
    recordJson?: boolean;
  };
  result?: Record<string, unknown>;
};

const sessions = new Map<string, SessionState>();
const baseDir = path.join(os.homedir(), '.agent-device');
const infoPath = path.join(baseDir, 'daemon.json');
const logPath = path.join(baseDir, 'daemon.log');
const sessionsDir = path.join(baseDir, 'sessions');
const version = readVersion();
const token = crypto.randomBytes(24).toString('hex');

function contextFromFlags(
  flags: CommandFlags | undefined,
  appBundleId?: string,
  traceLogPath?: string,
): {
  appBundleId?: string;
  activity?: string;
  verbose?: boolean;
  logPath?: string;
  traceLogPath?: string;
  snapshotInteractiveOnly?: boolean;
  snapshotCompact?: boolean;
  snapshotDepth?: number;
  snapshotScope?: string;
  snapshotBackend?: 'ax' | 'xctest';
  snapshotRaw?: boolean;
} {
  return {
    appBundleId,
    activity: flags?.activity,
    verbose: flags?.verbose,
    logPath,
    traceLogPath,
    snapshotInteractiveOnly: flags?.snapshotInteractiveOnly,
    snapshotCompact: flags?.snapshotCompact,
    snapshotDepth: flags?.snapshotDepth,
    snapshotScope: flags?.snapshotScope,
    snapshotRaw: flags?.snapshotRaw,
    snapshotBackend: flags?.snapshotBackend,
  };
}

async function handleRequest(req: DaemonRequest): Promise<DaemonResponse> {
  if (req.token !== token) {
    return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } };
  }

  const command = req.command;
  const sessionName = req.session || 'default';

  if (command === 'session_list') {
    const data = {
      sessions: Array.from(sessions.values()).map((s) => ({
        name: s.name,
        platform: s.device.platform,
        device: s.device.name,
        id: s.device.id,
        createdAt: s.createdAt,
      })),
    };
    return { ok: true, data };
  }

  if (command === 'devices') {
    try {
      const devices: DeviceInfo[] = [];
      if (req.flags?.platform === 'android') {
        const { listAndroidDevices } = await import('./platforms/android/devices.ts');
        devices.push(...(await listAndroidDevices()));
      } else if (req.flags?.platform === 'ios') {
        const { listIosDevices } = await import('./platforms/ios/devices.ts');
        devices.push(...(await listIosDevices()));
      } else {
        const { listAndroidDevices } = await import('./platforms/android/devices.ts');
        const { listIosDevices } = await import('./platforms/ios/devices.ts');
        try {
          devices.push(...(await listAndroidDevices()));
        } catch {
          // ignore
        }
        try {
          devices.push(...(await listIosDevices()));
        } catch {
          // ignore
        }
      }
      return { ok: true, data: { devices } };
    } catch (err) {
      const appErr = asAppError(err);
      return { ok: false, error: { code: appErr.code, message: appErr.message, details: appErr.details } };
    }
  }

  if (command === 'apps') {
    const session = sessions.get(sessionName);
    const flags = req.flags ?? {};
    if (
      !session &&
      !flags.platform &&
      !flags.device &&
      !flags.udid &&
      !flags.serial
    ) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'apps requires an active session or an explicit device selector (e.g. --platform ios).',
        },
      };
    }
    const device = session?.device ?? (await resolveTargetDevice(flags));
    await ensureDeviceReady(device);
    if (device.platform === 'ios') {
      if (device.kind !== 'simulator') {
        return { ok: false, error: { code: 'UNSUPPORTED_OPERATION', message: 'apps list is only supported on iOS simulators' } };
      }
      const { listSimulatorApps } = await import('./platforms/ios/index.ts');
      const apps = await listSimulatorApps(device);
      if (req.flags?.appsMetadata) {
        return { ok: true, data: { apps } };
      }
      const formatted = apps.map((app) =>
        app.name && app.name !== app.bundleId ? `${app.name} (${app.bundleId})` : app.bundleId,
      );
      return { ok: true, data: { apps: formatted } };
    }
    const { listAndroidApps, listAndroidAppsMetadata } = await import('./platforms/android/index.ts');
    if (req.flags?.appsMetadata) {
      const apps = await listAndroidAppsMetadata(device, req.flags?.appsFilter);
      return { ok: true, data: { apps } };
    }
    const apps = await listAndroidApps(device, req.flags?.appsFilter);
    return { ok: true, data: { apps } };
  }

  if (command === 'appstate') {
    const session = sessions.get(sessionName);
    const flags = req.flags ?? {};
    const device = session?.device ?? (await resolveTargetDevice(flags));
    await ensureDeviceReady(device);
    if (device.platform === 'ios') {
      if (session?.appBundleId) {
        return {
          ok: true,
          data: {
            platform: 'ios',
            appBundleId: session.appBundleId,
            appName: session.appName ?? session.appBundleId,
            source: 'session',
          },
        };
      }
      const snapshotResult = await resolveIosAppStateFromSnapshots(device, session?.trace?.outPath, req.flags);
      return {
        ok: true,
        data: {
          platform: 'ios',
          appName: snapshotResult.appName,
          appBundleId: snapshotResult.appBundleId,
          source: snapshotResult.source,
        },
      };
    }
    const { getAndroidAppState } = await import('./platforms/android/index.ts');
    const state = await getAndroidAppState(device);
    return {
      ok: true,
      data: {
        platform: 'android',
        package: state.package,
        activity: state.activity,
      },
    };
  }

  if (command === 'open') {
    if (sessions.has(sessionName)) {
      const session = sessions.get(sessionName);
      const appName = req.positionals?.[0];
      if (!session || !appName) {
        return {
          ok: false,
          error: {
            code: 'INVALID_ARGS',
            message: 'Session already active. Close it first or pass a new --session name.',
          },
        };
      }
      let appBundleId: string | undefined;
      if (session.device.platform === 'ios') {
        try {
          const { resolveIosApp } = await import('./platforms/ios/index.ts');
          appBundleId = await resolveIosApp(session.device, appName);
        } catch {
          appBundleId = undefined;
        }
      }
      await dispatchCommand(session.device, 'open', req.positionals ?? [], req.flags?.out, {
        ...contextFromFlags(req.flags, appBundleId),
      });
      const nextSession: SessionState = {
        ...session,
        appBundleId,
        appName,
        snapshot: undefined,
      };
      recordAction(nextSession, {
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: { session: sessionName, appName, appBundleId },
      });
      sessions.set(sessionName, nextSession);
      return { ok: true, data: { session: sessionName, appName, appBundleId } };
    }
    const device = await resolveTargetDevice(req.flags ?? {});
    await ensureDeviceReady(device);
    const inUse = Array.from(sessions.values()).find((s) => s.device.id === device.id);
    if (inUse) {
      return {
        ok: false,
        error: {
          code: 'DEVICE_IN_USE',
          message: `Device is already in use by session "${inUse.name}".`,
          details: { session: inUse.name, deviceId: device.id, deviceName: device.name },
        },
      };
    }
    let appBundleId: string | undefined;
    const appName = req.positionals?.[0];
    if (device.platform === 'ios') {
      try {
        const { resolveIosApp } = await import('./platforms/ios/index.ts');
        appBundleId = await resolveIosApp(device, req.positionals?.[0] ?? '');
      } catch {
        appBundleId = undefined;
      }
    }
    await dispatchCommand(device, 'open', req.positionals ?? [], req.flags?.out, {
      ...contextFromFlags(req.flags, appBundleId),
    });
    const session: SessionState = {
      name: sessionName,
      device,
      createdAt: Date.now(),
      appBundleId,
      appName,
      actions: [],
    };
    recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { session: sessionName },
    });
    sessions.set(sessionName, session);
    return { ok: true, data: { session: sessionName } };
  }

  if (command === 'replay') {
    const filePath = req.positionals?.[0];
    if (!filePath) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'replay requires a path' } };
    }
    try {
      const resolved = expandHome(filePath);
      const payload = JSON.parse(fs.readFileSync(resolved, 'utf8')) as {
        actions?: SessionAction[];
        optimizedActions?: SessionAction[];
      };
      const actions = payload.optimizedActions ?? payload.actions ?? [];
      for (const action of actions) {
        if (!action || action.command === 'replay') continue;
        await handleRequest({
          token,
          session: sessionName,
          command: action.command,
          positionals: action.positionals ?? [],
          flags: action.flags ?? {},
        });
      }
      return { ok: true, data: { replayed: actions.length, session: sessionName } };
    } catch (err) {
      const appErr = asAppError(err);
      return { ok: false, error: { code: appErr.code, message: appErr.message } };
    }
  }

  if (command === 'close') {
    const session = sessions.get(sessionName);
    if (!session) {
      return { ok: false, error: { code: 'SESSION_NOT_FOUND', message: 'No active session' } };
    }
    if (req.positionals && req.positionals.length > 0) {
      await dispatchCommand(session.device, 'close', req.positionals ?? [], req.flags?.out, {
        ...contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
      });
    }
    if (session.device.platform === 'ios' && session.device.kind === 'simulator') {
      await stopIosRunnerSession(session.device.id);
    }
    recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { session: sessionName },
    });
    writeSessionLog(session);
    sessions.delete(sessionName);
    return { ok: true, data: { session: sessionName } };
  }

  if (command === 'snapshot') {
    const session = sessions.get(sessionName);
    const device = session?.device ?? (await resolveTargetDevice(req.flags ?? {}));
    if (!session) {
      await ensureDeviceReady(device);
    }
    const appBundleId = session?.appBundleId;
    let snapshotScope = req.flags?.snapshotScope;
    if (snapshotScope && snapshotScope.trim().startsWith('@')) {
      if (!session?.snapshot) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'Ref scope requires an existing snapshot in session.' } };
      }
      const ref = normalizeRef(snapshotScope.trim());
      if (!ref) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: `Invalid ref scope: ${snapshotScope}` } };
      }
      const node = findNodeByRef(session.snapshot.nodes, ref);
      const resolved = node ? resolveRefLabel(node, session.snapshot.nodes) : undefined;
      if (!resolved) {
        return { ok: false, error: { code: 'COMMAND_FAILED', message: `Ref ${snapshotScope} not found or has no label` } };
      }
      snapshotScope = resolved;
    }
    const data = (await dispatchCommand(device, 'snapshot', [], req.flags?.out, {
      ...contextFromFlags({ ...req.flags, snapshotScope }, appBundleId, session?.trace?.outPath),
    })) as {
      nodes?: RawSnapshotNode[];
      truncated?: boolean;
      backend?: 'ax' | 'xctest' | 'android';
    };
    const rawNodes = data?.nodes ?? [];
    const nodes = attachRefs(req.flags?.snapshotRaw ? rawNodes : pruneGroupNodes(rawNodes));
    const snapshot: SnapshotState = {
      nodes,
      truncated: data?.truncated,
      createdAt: Date.now(),
      backend: data?.backend,
    };
    const nextSession: SessionState = {
      name: sessionName,
      device,
      createdAt: session?.createdAt ?? Date.now(),
      appBundleId: session?.appBundleId ?? appBundleId,
      snapshot,
      actions: session?.actions ?? [],
      appName: session?.appName,
    };
    recordAction(nextSession, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { nodes: nodes.length, truncated: data?.truncated ?? false },
    });
    sessions.set(sessionName, nextSession);
    return {
      ok: true,
      data: {
        nodes,
        truncated: data?.truncated ?? false,
        appName: nextSession.appBundleId ? (nextSession.appName ?? nextSession.appBundleId) : undefined,
        appBundleId: nextSession.appBundleId,
      },
    };
  }

  if (command === 'wait') {
    const session = sessions.get(sessionName);
    const device = session?.device ?? (await resolveTargetDevice(req.flags ?? {}));
    if (!session) {
      await ensureDeviceReady(device);
    }
    const args = req.positionals ?? [];
    if (args.length === 0) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'wait requires a duration or text' } };
    }
    const parseTimeout = (value: string | undefined): number | null => {
      if (!value) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const sleepMs = parseTimeout(args[0]);
    if (sleepMs !== null) {
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
      if (session) {
        recordAction(session, { command, positionals: req.positionals ?? [], flags: req.flags ?? {}, result: { waitedMs: sleepMs } });
      }
      return { ok: true, data: { waitedMs: sleepMs } };
    }
    let text = '';
    let timeoutMs: number | null = null;
    if (args[0] === 'text') {
      timeoutMs = parseTimeout(args[args.length - 1]);
      text = timeoutMs !== null ? args.slice(1, -1).join(' ') : args.slice(1).join(' ');
    } else if (args[0].startsWith('@')) {
      if (!session?.snapshot) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'Ref wait requires an existing snapshot in session.' } };
      }
      const ref = normalizeRef(args[0]);
      if (!ref) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: `Invalid ref: ${args[0]}` } };
      }
      const node = findNodeByRef(session.snapshot.nodes, ref);
      const resolved = node ? resolveRefLabel(node, session.snapshot.nodes) : undefined;
      if (!resolved) {
        return { ok: false, error: { code: 'COMMAND_FAILED', message: `Ref ${args[0]} not found or has no label` } };
      }
      timeoutMs = parseTimeout(args[args.length - 1]);
      text = resolved;
    } else {
      timeoutMs = parseTimeout(args[args.length - 1]);
      text = timeoutMs !== null ? args.slice(0, -1).join(' ') : args.join(' ');
    }
    text = text.trim();
    if (!text) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'wait requires text' } };
    }
    const timeout = timeoutMs ?? 10000;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (device.platform === 'ios' && device.kind === 'simulator') {
        const result = (await runIosRunnerCommand(
          device,
          { command: 'findText', text, appBundleId: session?.appBundleId },
          { verbose: req.flags?.verbose, logPath, traceLogPath: session?.trace?.outPath },
        )) as { found?: boolean };
        if (result?.found) {
          if (session) {
            recordAction(session, { command, positionals: req.positionals ?? [], flags: req.flags ?? {}, result: { text, waitedMs: Date.now() - start } });
          }
          return { ok: true, data: { text, waitedMs: Date.now() - start } };
        }
      } else if (device.platform === 'android') {
        const androidResult = await snapshotAndroid(device, { scope: text });
        if (findNodeByLabel(attachRefs(androidResult.nodes ?? []), text)) {
          if (session) {
            recordAction(session, { command, positionals: req.positionals ?? [], flags: req.flags ?? {}, result: { text, waitedMs: Date.now() - start } });
          }
          return { ok: true, data: { text, waitedMs: Date.now() - start } };
        }
      } else {
        return { ok: false, error: { code: 'UNSUPPORTED_OPERATION', message: 'wait is not supported on this device' } };
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return { ok: false, error: { code: 'COMMAND_FAILED', message: `wait timed out for text: ${text}` } };
  }

  if (command === 'alert') {
    const session = sessions.get(sessionName);
    const device = session?.device ?? (await resolveTargetDevice(req.flags ?? {}));
    if (!session) {
      await ensureDeviceReady(device);
    }
    const action = (req.positionals?.[0] ?? 'get').toLowerCase();
    const parseTimeout = (value: string | undefined): number | null => {
      if (!value) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    if (device.platform !== 'ios' || device.kind !== 'simulator') {
      return { ok: false, error: { code: 'UNSUPPORTED_OPERATION', message: 'alert is only supported on iOS simulators in v1' } };
    }
    if (action === 'wait') {
      const timeout = parseTimeout(req.positionals?.[1]) ?? 10000;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        try {
          const data = await runIosRunnerCommand(
            device,
            { command: 'alert', action: 'get', appBundleId: session?.appBundleId },
            { verbose: req.flags?.verbose, logPath, traceLogPath: session?.trace?.outPath },
          );
          if (session) {
            recordAction(session, {
              command,
              positionals: req.positionals ?? [],
              flags: req.flags ?? {},
              result: data,
            });
          }
          return { ok: true, data };
        } catch {
          // keep waiting
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      return { ok: false, error: { code: 'COMMAND_FAILED', message: 'alert wait timed out' } };
    }
    const data = await runIosRunnerCommand(
      device,
      {
        command: 'alert',
        action: action === 'accept' || action === 'dismiss' ? (action as 'accept' | 'dismiss') : 'get',
        appBundleId: session?.appBundleId,
      },
      { verbose: req.flags?.verbose, logPath, traceLogPath: session?.trace?.outPath },
    );
    if (session) {
      recordAction(session, {
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: data,
      });
    }
    return { ok: true, data };
  }

  if (command === 'record') {
    const action = (req.positionals?.[0] ?? '').toLowerCase();
    if (!['start', 'stop'].includes(action)) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'record requires start|stop' } };
    }
    const session = sessions.get(sessionName);
    const device = session?.device ?? (await resolveTargetDevice(req.flags ?? {}));
    if (!session) {
      await ensureDeviceReady(device);
    }
    const activeSession = session ?? {
      name: sessionName,
      device,
      createdAt: Date.now(),
      actions: [],
    };

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
      if (device.platform === 'ios') {
        if (device.kind !== 'simulator') {
          return { ok: false, error: { code: 'UNSUPPORTED_OPERATION', message: 'record is only supported on iOS simulators in v1' } };
        }
        const { child, wait } = runCmdBackground('xcrun', ['simctl', 'io', device.id, 'recordVideo', resolvedOut], {
          allowFailure: true,
        });
        activeSession.recording = { platform: 'ios', outPath: resolvedOut, child, wait };
      } else {
        const remotePath = `/sdcard/agent-device-recording-${Date.now()}.mp4`;
        const { child, wait } = runCmdBackground('adb', ['-s', device.id, 'shell', 'screenrecord', remotePath], {
          allowFailure: true,
        });
        activeSession.recording = { platform: 'android', outPath: resolvedOut, remotePath, child, wait };
      }
      sessions.set(sessionName, activeSession);
      recordAction(activeSession, {
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: { action: 'start' },
      });
      return { ok: true, data: { recording: 'started', outPath } };
    }

    if (!activeSession.recording) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'no active recording' } };
    }
    const recording = activeSession.recording;
    recording.child.kill('SIGINT');
    try {
      await recording.wait;
    } catch {
      // ignore
    }
    if (recording.platform === 'android' && recording.remotePath) {
      try {
        await runCmd('adb', ['-s', device.id, 'pull', recording.remotePath, recording.outPath], { allowFailure: true });
        await runCmd('adb', ['-s', device.id, 'shell', 'rm', '-f', recording.remotePath], { allowFailure: true });
      } catch {
        // ignore
      }
    }
    activeSession.recording = undefined;
    recordAction(activeSession, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { action: 'stop', outPath: recording.outPath },
    });
    return { ok: true, data: { recording: 'stopped', outPath: recording.outPath } };
  }

  if (command === 'trace') {
    const action = (req.positionals?.[0] ?? '').toLowerCase();
    if (!['start', 'stop'].includes(action)) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'trace requires start|stop' } };
    }
    const session = sessions.get(sessionName);
    if (!session) {
      return { ok: false, error: { code: 'SESSION_NOT_FOUND', message: 'No active session' } };
    }
    if (action === 'start') {
      if (session.trace) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'trace already in progress' } };
      }
      const outPath = req.positionals?.[1] ?? defaultTracePath(session);
      const resolvedOut = expandHome(outPath);
      fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
      fs.appendFileSync(resolvedOut, '');
      session.trace = { outPath: resolvedOut, startedAt: Date.now() };
      recordAction(session, {
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: { action: 'start', outPath: resolvedOut },
      });
      return { ok: true, data: { trace: 'started', outPath: resolvedOut } };
    }
    if (!session.trace) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'no active trace' } };
    }
    let outPath = session.trace.outPath;
    if (req.positionals?.[1]) {
      const resolvedOut = expandHome(req.positionals[1]);
      fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
      if (fs.existsSync(outPath)) {
        fs.renameSync(outPath, resolvedOut);
      } else {
        fs.appendFileSync(resolvedOut, '');
      }
      outPath = resolvedOut;
    }
    session.trace = undefined;
    recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { action: 'stop', outPath },
    });
    return { ok: true, data: { trace: 'stopped', outPath } };
  }

  if (command === 'settings') {
    const setting = req.positionals?.[0];
    const state = req.positionals?.[1];
    if (!setting || !state) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'settings requires <wifi|airplane|location> <on|off>' } };
    }
    const session = sessions.get(sessionName);
    const device = session?.device ?? (await resolveTargetDevice(req.flags ?? {}));
    if (!session) {
      await ensureDeviceReady(device);
    }
    const appBundleId = session?.appBundleId;
    const data = await dispatchCommand(
      device,
      'settings',
      [setting, state, appBundleId ?? ''],
      req.flags?.out,
      { ...contextFromFlags(req.flags, appBundleId, session?.trace?.outPath) },
    );
    if (session) {
      recordAction(session, {
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: data ?? { setting, state },
      });
    }
    return { ok: true, data: data ?? { setting, state } };
  }

  if (command === 'find') {
    const args = req.positionals ?? [];
    if (args.length === 0) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'find requires a locator or text' } };
    }
    const { locator, query, action, value, timeoutMs } = parseFindArgs(args);
    if (!query) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'find requires a value' } };
    }
    const session = sessions.get(sessionName);
    const isReadOnly = action === 'exists' || action === 'wait' || action === 'get_text' || action === 'get_attrs';
    if (!session && !isReadOnly) {
      return {
        ok: false,
        error: { code: 'SESSION_NOT_FOUND', message: 'No active session. Run open first.' },
      };
    }
    const device = session?.device ?? (await resolveTargetDevice(req.flags ?? {}));
    if (!session) {
      await ensureDeviceReady(device);
    }
    const appBundleId = session?.appBundleId;
    const scope = shouldScopeFind(locator) ? query : undefined;
    const requiresRect = action === 'click' || action === 'focus' || action === 'fill' || action === 'type';
    const interactiveOnly = requiresRect;
    let lastSnapshotAt = 0;
    let lastNodes: SnapshotState['nodes'] | null = null;
    const fetchNodes = async (): Promise<{
      nodes: SnapshotState['nodes'];
      truncated?: boolean;
      backend?: SnapshotState['backend'];
    }> => {
      const now = Date.now();
      if (lastNodes && now - lastSnapshotAt < 750) {
        return { nodes: lastNodes };
      }
      const data = (await dispatchCommand(device, 'snapshot', [], req.flags?.out, {
        ...contextFromFlags(
          {
            ...req.flags,
            snapshotScope: scope,
            snapshotInteractiveOnly: interactiveOnly,
            snapshotCompact: interactiveOnly,
          },
          appBundleId,
          session?.trace?.outPath,
        ),
      })) as {
        nodes?: RawSnapshotNode[];
        truncated?: boolean;
        backend?: 'ax' | 'xctest' | 'android';
      };
      const rawNodes = data?.nodes ?? [];
      const nodes = attachRefs(req.flags?.snapshotRaw ? rawNodes : pruneGroupNodes(rawNodes));
      lastSnapshotAt = now;
      lastNodes = nodes;
      if (session) {
        const snapshot: SnapshotState = {
          nodes,
          truncated: data?.truncated,
          createdAt: Date.now(),
          backend: data?.backend,
        };
        session.snapshot = snapshot;
        sessions.set(sessionName, session);
      }
      return { nodes, truncated: data?.truncated, backend: data?.backend };
    };
    if (action === 'wait') {
      const timeout = timeoutMs ?? 10000;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const { nodes } = await fetchNodes();
        const match = findNodeByLocator(nodes, locator, query, { requireRect: false });
        if (match) {
          if (session) {
            recordAction(session, {
              command,
              positionals: req.positionals ?? [],
              flags: req.flags ?? {},
              result: { found: true, waitedMs: Date.now() - start },
            });
          }
          return { ok: true, data: { found: true, waitedMs: Date.now() - start } };
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      return { ok: false, error: { code: 'COMMAND_FAILED', message: 'find wait timed out' } };
    }
    const { nodes } = await fetchNodes();
    const node = findNodeByLocator(nodes, locator, query, { requireRect: requiresRect });
    if (!node) {
      return { ok: false, error: { code: 'COMMAND_FAILED', message: 'find did not match any element' } };
    }
    const resolvedNode =
      action === 'click' || action === 'focus' || action === 'fill' || action === 'type'
        ? findNearestHittableAncestor(nodes, node) ?? node
        : node;
    const ref = `@${resolvedNode.ref}`;
    const actionFlags = { ...(req.flags ?? {}), noRecord: true };
    if (action === 'exists') {
      if (session) {
        recordAction(session, {
          command,
          positionals: req.positionals ?? [],
          flags: req.flags ?? {},
          result: { found: true },
        });
      }
      return { ok: true, data: { found: true } };
    }
    if (action === 'get_text') {
      const text = extractNodeText(node);
      if (session) {
        recordAction(session, {
          command,
          positionals: req.positionals ?? [],
          flags: req.flags ?? {},
          result: { ref, action: 'get text', text },
        });
      }
      return { ok: true, data: { ref, text, node } };
    }
    if (action === 'get_attrs') {
      if (session) {
        recordAction(session, {
          command,
          positionals: req.positionals ?? [],
          flags: req.flags ?? {},
          result: { ref, action: 'get attrs' },
        });
      }
      return { ok: true, data: { ref, node } };
    }
    if (action === 'click') {
      const response = await handleRequest({
        token,
        session: sessionName,
        command: 'click',
        positionals: [ref],
        flags: actionFlags,
      });
      if (!response.ok) return response;
      if (session) {
        recordAction(session, {
          command,
          positionals: req.positionals ?? [],
          flags: req.flags ?? {},
          result: { ref, action: 'click' },
        });
      }
      return response;
    }
    if (action === 'fill') {
      if (!value) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'find fill requires text' } };
      }
      const response = await handleRequest({
        token,
        session: sessionName,
        command: 'fill',
        positionals: [ref, value],
        flags: actionFlags,
      });
      if (!response.ok) return response;
      if (session) {
        recordAction(session, {
          command,
          positionals: req.positionals ?? [],
          flags: req.flags ?? {},
          result: { ref, action: 'fill' },
        });
      }
      return response;
    }
    if (action === 'focus') {
      const coords = node.rect ? centerOfRect(node.rect) : null;
      if (!coords) {
        return { ok: false, error: { code: 'COMMAND_FAILED', message: 'matched element has no bounds' } };
      }
      const response = await dispatchCommand(
        device,
        'focus',
        [String(coords.x), String(coords.y)],
        req.flags?.out,
        { ...contextFromFlags(req.flags, session?.appBundleId, session?.trace?.outPath) },
      );
      if (session) {
        recordAction(session, {
          command,
          positionals: req.positionals ?? [],
          flags: req.flags ?? {},
          result: { ref, action: 'focus' },
        });
      }
      return { ok: true, data: response ?? { ref } };
    }
    if (action === 'type') {
      if (!value) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'find type requires text' } };
      }
      const coords = node.rect ? centerOfRect(node.rect) : null;
      if (!coords) {
        return { ok: false, error: { code: 'COMMAND_FAILED', message: 'matched element has no bounds' } };
      }
      await dispatchCommand(
        device,
        'focus',
        [String(coords.x), String(coords.y)],
        req.flags?.out,
        { ...contextFromFlags(req.flags, session?.appBundleId, session?.trace?.outPath) },
      );
      const response = await dispatchCommand(
        device,
        'type',
        [value],
        req.flags?.out,
        { ...contextFromFlags(req.flags, session?.appBundleId, session?.trace?.outPath) },
      );
      if (session) {
        recordAction(session, {
          command,
          positionals: req.positionals ?? [],
          flags: req.flags ?? {},
          result: { ref, action: 'type' },
        });
      }
      return { ok: true, data: response ?? { ref } };
    }
  }

  if (command === 'click') {
    const session = sessions.get(sessionName);
    if (!session?.snapshot) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'No snapshot in session. Run snapshot first.' } };
    }
    const refInput = req.positionals?.[0] ?? '';
    const ref = normalizeRef(refInput);
    if (!ref) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'click requires a ref like @e2' } };
    }
    let node = findNodeByRef(session.snapshot.nodes, ref);
    if (!node?.rect && req.positionals.length > 1) {
      const fallbackLabel = req.positionals.slice(1).join(' ').trim();
      if (fallbackLabel.length > 0) {
        node = findNodeByLabel(session.snapshot.nodes, fallbackLabel);
      }
    }
    if (!node?.rect) {
      return { ok: false, error: { code: 'COMMAND_FAILED', message: `Ref ${refInput} not found or has no bounds` } };
    }
    const refLabel = resolveRefLabel(node, session.snapshot.nodes);
    const { x, y } = centerOfRect(node.rect);
    await dispatchCommand(session.device, 'press', [String(x), String(y)], req.flags?.out, {
      ...contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
    });
    recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { ref, x, y, refLabel },
    });
    return { ok: true, data: { ref, x, y } };
  }

  if (command === 'fill') {
    const session = sessions.get(sessionName);
    if (req.positionals?.[0]?.startsWith('@')) {
      if (!session?.snapshot) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'No snapshot in session. Run snapshot first.' } };
      }
      const ref = normalizeRef(req.positionals[0]);
      if (!ref) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'fill requires a ref like @e2' } };
      }
      const labelCandidate = req.positionals.length >= 3 ? req.positionals[1] : '';
      const text = req.positionals.length >= 3 ? req.positionals.slice(2).join(' ') : req.positionals.slice(1).join(' ');
      if (!text) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'fill requires text after ref' } };
      }
      let node = findNodeByRef(session.snapshot.nodes, ref);
      if (!node?.rect && labelCandidate) {
        node = findNodeByLabel(session.snapshot.nodes, labelCandidate);
      }
      if (!node?.rect) {
        return { ok: false, error: { code: 'COMMAND_FAILED', message: `Ref ${req.positionals[0]} not found or has no bounds` } };
      }
      const refLabel = resolveRefLabel(node, session.snapshot.nodes);
      const label = node.label?.trim();
      if (session.device.platform === 'ios' && session.device.kind === 'simulator' && isTextInputType(node.type)) {
        const coords = node.rect ? centerOfRect(node.rect) : null;
        if (!coords) {
          return {
            ok: false,
            error: { code: 'COMMAND_FAILED', message: `Ref ${req.positionals[0]} not found or has no bounds` },
          };
        }
        await dispatchCommand(session.device, 'focus', [String(coords.x), String(coords.y)], req.flags?.out, {
          ...contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
        });
        await runIosRunnerCommand(
          session.device,
          { command: 'type', text, appBundleId: session.appBundleId },
          { verbose: req.flags?.verbose, logPath, traceLogPath: session?.trace?.outPath },
        );
        recordAction(session, {
          command,
          positionals: req.positionals ?? [],
          flags: req.flags ?? {},
          result: { ref, refLabel: refLabel ?? label, action: 'fill', text },
        });
        return { ok: true, data: { ref } };
      }
      const { x, y } = centerOfRect(node.rect);
      const data = await dispatchCommand(
        session.device,
        'fill',
        [String(x), String(y), text],
        req.flags?.out,
        {
          ...contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
        },
      );
      recordAction(session, {
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: data ?? { ref, x, y, refLabel },
      });
      return { ok: true, data: data ?? { ref, x, y } };
    }
  }

  if (command === 'get') {
    const sub = req.positionals?.[0];
    const refInput = req.positionals?.[1];
    if (sub !== 'text' && sub !== 'attrs') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'get only supports text or attrs' } };
    }
    const session = sessions.get(sessionName);
    if (!session?.snapshot) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'No snapshot in session. Run snapshot first.' } };
    }
    const ref = normalizeRef(refInput ?? '');
    if (!ref) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'get text requires a ref like @e2' } };
    }
    let node = findNodeByRef(session.snapshot.nodes, ref);
    if (!node && req.positionals.length > 2) {
      const labelCandidate = req.positionals.slice(2).join(' ').trim();
      if (labelCandidate.length > 0) {
        node = findNodeByLabel(session.snapshot.nodes, labelCandidate);
      }
    }
    if (!node) {
      return { ok: false, error: { code: 'COMMAND_FAILED', message: `Ref ${refInput} not found` } };
    }
    if (sub === 'attrs') {
      recordAction(session, {
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: { ref },
      });
      return { ok: true, data: { ref, node } };
    }
    const candidates = [node.label, node.value, node.identifier]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0);
    const text = candidates[0] ?? '';
    recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { ref, text, refLabel: text || undefined },
    });
    return { ok: true, data: { ref, text, node } };
  }


  const session = sessions.get(sessionName);
  if (!session) {
    return {
      ok: false,
      error: { code: 'SESSION_NOT_FOUND', message: 'No active session. Run open first.' },
    };
  }

  const data = await dispatchCommand(session.device, command, req.positionals ?? [], req.flags?.out, {
    ...contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
  });
  recordAction(session, {
    command,
    positionals: req.positionals ?? [],
    flags: req.flags ?? {},
    result: data ?? {},
  });
  return { ok: true, data: data ?? {} };
}

function writeInfo(port: number): void {
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(logPath, '');
  fs.writeFileSync(
    infoPath,
    JSON.stringify({ port, token, pid: process.pid, version }, null, 2),
    {
      mode: 0o600,
    },
  );
}

function removeInfo(): void {
  if (fs.existsSync(infoPath)) fs.unlinkSync(infoPath);
}

function start(): void {
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', async (chunk) => {
      buffer += chunk;
      let idx = buffer.indexOf('\n');
      while (idx !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line.length === 0) {
          idx = buffer.indexOf('\n');
          continue;
        }
        let response: DaemonResponse;
        try {
          const req = JSON.parse(line) as DaemonRequest;
          response = await handleRequest(req);
        } catch (err) {
          const appErr = asAppError(err);
          response = {
            ok: false,
            error: { code: appErr.code, message: appErr.message, details: appErr.details },
          };
        }
        socket.write(`${JSON.stringify(response)}\n`);
        idx = buffer.indexOf('\n');
      }
    });
  });

  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (typeof address === 'object' && address?.port) {
      writeInfo(address.port);
      process.stdout.write(`AGENT_DEVICE_DAEMON_PORT=${address.port}\n`);
    }
  });

  const shutdown = async () => {
    const sessionsToStop = Array.from(sessions.values());
    for (const session of sessionsToStop) {
      if (session.device.platform === 'ios' && session.device.kind === 'simulator') {
        await stopIosRunnerSession(session.device.id);
      }
      writeSessionLog(session);
    }
    server.close(() => {
      removeInfo();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGHUP', () => {
    void shutdown();
  });
  process.on('uncaughtException', (err) => {
    const appErr = err instanceof AppError ? err : asAppError(err);
    process.stderr.write(`Daemon error: ${appErr.message}\n`);
    void shutdown();
  });
}

start();

function recordAction(
  session: SessionState,
  entry: {
    command: string;
    positionals: string[];
    flags: CommandFlags;
    result?: Record<string, unknown>;
  },
): void {
  if (entry.flags?.noRecord) return;
  session.actions.push({
    ts: Date.now(),
    command: entry.command,
    positionals: entry.positionals,
    flags: sanitizeFlags(entry.flags),
    result: entry.result,
  });
}

function sanitizeFlags(flags: CommandFlags | undefined): SessionAction['flags'] {
  if (!flags) return {};
  const {
    platform,
    device,
    udid,
    serial,
    out,
    verbose,
    snapshotInteractiveOnly,
    snapshotCompact,
    snapshotDepth,
    snapshotScope,
    snapshotRaw,
    snapshotBackend,
    appsMetadata,
    noRecord,
    recordJson,
  } = flags as any;
  return {
    platform,
    device,
    udid,
    serial,
    out,
    verbose,
    snapshotInteractiveOnly,
    snapshotCompact,
    snapshotDepth,
    snapshotScope,
    snapshotRaw,
    snapshotBackend,
    appsMetadata,
    noRecord,
    recordJson,
  };
}

type FindAction =
  | { kind: 'click' }
  | { kind: 'focus' }
  | { kind: 'fill'; value: string }
  | { kind: 'type'; value: string }
  | { kind: 'get_text' }
  | { kind: 'get_attrs' }
  | { kind: 'exists' }
  | { kind: 'wait'; timeoutMs?: number };

function parseFindArgs(args: string[]): {
  locator: FindLocator;
  query: string;
  action: FindAction['kind'];
  value?: string;
  timeoutMs?: number;
} {
  const locatorTokens: FindLocator[] = ['text', 'label', 'value', 'role', 'id'];
  let locator: FindLocator = 'any';
  let queryIndex = 0;
  if (locatorTokens.includes(args[0] as FindLocator)) {
    locator = args[0] as FindLocator;
    queryIndex = 1;
  }
  const query = args[queryIndex] ?? '';
  const actionTokens = args.slice(queryIndex + 1);
  if (actionTokens.length === 0) {
    return { locator, query, action: 'click' };
  }
  const action = actionTokens[0].toLowerCase();
  if (action === 'get') {
    const sub = actionTokens[1]?.toLowerCase();
    if (sub === 'text') return { locator, query, action: 'get_text' };
    if (sub === 'attrs') return { locator, query, action: 'get_attrs' };
    throw new AppError('INVALID_ARGS', 'find get only supports text or attrs');
  }
  if (action === 'wait') {
    const timeoutMs = parseTimeout(actionTokens[1]);
    return { locator, query, action: 'wait', timeoutMs: timeoutMs ?? undefined };
  }
  if (action === 'exists') return { locator, query, action: 'exists' };
  if (action === 'click') return { locator, query, action: 'click' };
  if (action === 'focus') return { locator, query, action: 'focus' };
  if (action === 'fill') {
    const value = actionTokens.slice(1).join(' ');
    return { locator, query, action: 'fill', value };
  }
  if (action === 'type') {
    const value = actionTokens.slice(1).join(' ');
    return { locator, query, action: 'type', value };
  }
  throw new AppError('INVALID_ARGS', `Unsupported find action: ${actionTokens[0]}`);
}

function parseTimeout(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function shouldScopeFind(locator: FindLocator): boolean {
  return locator !== 'role';
}

function extractNodeText(node: SnapshotState['nodes'][number]): string {
  const candidates = [node.label, node.value, node.identifier]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0);
  return candidates[0] ?? '';
}

async function resolveIosAppStateFromSnapshots(
  device: DeviceInfo,
  traceLogPath: string | undefined,
  flags: CommandFlags | undefined,
): Promise<{ appName: string; appBundleId?: string; source: 'snapshot-ax' | 'snapshot-xctest' }> {
  const axResult = await dispatchCommand(device, 'snapshot', [], flags?.out, {
    ...contextFromFlags(
      {
        ...flags,
        snapshotDepth: 1,
        snapshotCompact: true,
        snapshotBackend: 'ax',
      },
      undefined,
      traceLogPath,
    ),
  });
  const axNode = extractAppNodeFromSnapshot(axResult as { nodes?: RawSnapshotNode[] });
  if (axNode?.appName || axNode?.appBundleId) {
    return {
      appName: axNode.appName ?? axNode.appBundleId ?? 'unknown',
      appBundleId: axNode.appBundleId,
      source: 'snapshot-ax',
    };
  }
  const xctestResult = await dispatchCommand(device, 'snapshot', [], flags?.out, {
    ...contextFromFlags(
      {
        ...flags,
        snapshotDepth: 1,
        snapshotCompact: true,
        snapshotBackend: 'xctest',
      },
      undefined,
      traceLogPath,
    ),
  });
  const xcNode = extractAppNodeFromSnapshot(xctestResult as { nodes?: RawSnapshotNode[] });
  return {
    appName: xcNode?.appName ?? xcNode?.appBundleId ?? 'unknown',
    appBundleId: xcNode?.appBundleId,
    source: 'snapshot-xctest',
  };
}

function extractAppNodeFromSnapshot(
  data: { nodes?: RawSnapshotNode[] } | undefined,
): { appName?: string; appBundleId?: string } | null {
  const rawNodes = data?.nodes ?? [];
  const nodes = attachRefs(rawNodes);
  const appNode = nodes.find((node) => normalizeType(node.type ?? '') === 'application') ?? nodes[0];
  if (!appNode) return null;
  const appName = appNode.label?.trim();
  const appBundleId = appNode.identifier?.trim();
  if (!appName && !appBundleId) return null;
  return { appName: appName || undefined, appBundleId: appBundleId || undefined };
}

function writeSessionLog(session: SessionState): void {
  try {
    if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
    const safeName = session.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const timestamp = new Date(session.createdAt).toISOString().replace(/[:.]/g, '-');
    const scriptPath = path.join(sessionsDir, `${safeName}-${timestamp}.ad`);
    const filePath = path.join(sessionsDir, `${safeName}-${timestamp}.json`);
    const payload = {
      name: session.name,
      device: session.device,
      createdAt: session.createdAt,
      appBundleId: session.appBundleId,
      actions: session.actions,
      optimizedActions: buildOptimizedActions(session),
    };
    const script = formatScript(session, payload.optimizedActions);
    fs.writeFileSync(scriptPath, script);
    if (session.actions.some((action) => action.flags?.recordJson)) {
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    }
  } catch {
    // ignore
  }
}

function defaultTracePath(session: SessionState): string {
  const safeName = session.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(sessionsDir, `${safeName}-${timestamp}.trace.log`);
}

function expandHome(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return path.resolve(filePath);
}

function buildOptimizedActions(session: SessionState): SessionAction[] {
  const optimized: SessionAction[] = [];
  for (const action of session.actions) {
    if (action.command === 'snapshot') {
      continue;
    }
    if (action.command === 'click' || action.command === 'fill' || action.command === 'get') {
      const refLabel = action.result?.refLabel;
      if (typeof refLabel === 'string' && refLabel.trim().length > 0) {
        optimized.push({
          ts: action.ts,
          command: 'snapshot',
          positionals: [],
          flags: {
            platform: session.device.platform,
            snapshotInteractiveOnly: true,
            snapshotCompact: true,
            snapshotScope: refLabel.trim(),
          },
          result: { scope: refLabel.trim() },
        });
      }
    }
    optimized.push(action);
  }
  return optimized;
}

function formatScript(session: SessionState, actions: SessionAction[]): string {
  const lines: string[] = [];
  const deviceLabel = session.device.name.replace(/"/g, '\\"');
  const kind = session.device.kind ? ` kind=${session.device.kind}` : '';
  const theme = 'unknown';
  lines.push(`context platform=${session.device.platform} device="${deviceLabel}"${kind} theme=${theme}`);
  for (const action of actions) {
    if (action.flags?.noRecord) continue;
    lines.push(formatActionLine(action));
  }
  return `${lines.join('\n')}\n`;
}

function formatActionLine(action: SessionAction): string {
  const parts: string[] = [action.command];
  if (action.command === 'click') {
    const ref = action.positionals?.[0];
    if (ref) {
      parts.push(formatArg(ref));
      const refLabel = action.result?.refLabel;
      if (typeof refLabel === 'string' && refLabel.trim().length > 0) {
        parts.push(formatArg(refLabel));
      }
      return parts.join(' ');
    }
  }
  if (action.command === 'fill') {
    const ref = action.positionals?.[0];
    if (ref && ref.startsWith('@')) {
      parts.push(formatArg(ref));
      const refLabel = action.result?.refLabel;
      const text = action.positionals.slice(1).join(' ');
      if (typeof refLabel === 'string' && refLabel.trim().length > 0) {
        parts.push(formatArg(refLabel));
      }
      if (text) {
        parts.push(formatArg(text));
      }
      return parts.join(' ');
    }
  }
  if (action.command === 'get') {
    const sub = action.positionals?.[0];
    const ref = action.positionals?.[1];
    if (sub && ref) {
      parts.push(formatArg(sub));
      parts.push(formatArg(ref));
      const refLabel = action.result?.refLabel;
      if (typeof refLabel === 'string' && refLabel.trim().length > 0) {
        parts.push(formatArg(refLabel));
      }
      return parts.join(' ');
    }
  }
  if (action.command === 'snapshot') {
    if (action.flags?.snapshotInteractiveOnly) parts.push('-i');
    if (action.flags?.snapshotCompact) parts.push('-c');
    if (typeof action.flags?.snapshotDepth === 'number') {
      parts.push('-d', String(action.flags.snapshotDepth));
    }
    if (action.flags?.snapshotScope) {
      parts.push('-s', formatArg(action.flags.snapshotScope));
    }
    if (action.flags?.snapshotRaw) parts.push('--raw');
    if (action.flags?.snapshotBackend) {
      parts.push(`--backend`, action.flags.snapshotBackend);
    }
    return parts.join(' ');
  }
  for (const positional of action.positionals ?? []) {
    parts.push(formatArg(positional));
  }
  return parts.join(' ');
}

function formatArg(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('@')) return trimmed;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  return JSON.stringify(trimmed);
}

function findNodeByLabel(nodes: SnapshotState['nodes'], label: string) {
  const query = label.toLowerCase();
  return (
    nodes.find((node) => {
      const labelValue = (node.label ?? '').toLowerCase();
      const valueValue = (node.value ?? '').toLowerCase();
      const idValue = (node.identifier ?? '').toLowerCase();
      return labelValue.includes(query) || valueValue.includes(query) || idValue.includes(query);
    }) ?? null
  );
}

function resolveRefLabel(
  node: SnapshotState['nodes'][number],
  nodes: SnapshotState['nodes'],
): string | undefined {
  const primary = [node.label, node.value, node.identifier]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find((value) => value && value.length > 0);
  if (primary && isMeaningfulLabel(primary)) return primary;
  const fallback = findNearestMeaningfulLabel(node, nodes);
  return fallback ?? (primary && isMeaningfulLabel(primary) ? primary : undefined);
}

function isMeaningfulLabel(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^(true|false)$/i.test(trimmed)) return false;
  if (/^\d+$/.test(trimmed)) return false;
  return true;
}

function findNearestMeaningfulLabel(
  target: SnapshotState['nodes'][number],
  nodes: SnapshotState['nodes'],
): string | undefined {
  if (!target.rect) return undefined;
  const targetY = target.rect.y + target.rect.height / 2;
  let best: { label: string; distance: number } | null = null;
  for (const node of nodes) {
    if (!node.rect) continue;
    const label = [node.label, node.value, node.identifier]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .find((value) => value && value.length > 0);
    if (!label || !isMeaningfulLabel(label)) continue;
    const nodeY = node.rect.y + node.rect.height / 2;
    const distance = Math.abs(nodeY - targetY);
    if (!best || distance < best.distance) {
      best = { label, distance };
    }
  }
  return best?.label;
}

async function ensureDeviceReady(device: DeviceInfo): Promise<void> {
  if (device.platform === 'ios' && device.kind === 'simulator') {
    const { ensureBootedSimulator } = await import('./platforms/ios/index.ts');
    await ensureBootedSimulator(device);
    return;
  }
  if (device.platform === 'android') {
    const { waitForAndroidBoot } = await import('./platforms/android/devices.ts');
    await waitForAndroidBoot(device.id);
  }
}

function isLabelUnique(nodes: SnapshotState['nodes'], label: string): boolean {
  const target = label.trim().toLowerCase();
  if (!target) return false;
  let count = 0;
  for (const node of nodes) {
    if ((node.label ?? '').trim().toLowerCase() === target) {
      count += 1;
      if (count > 1) return false;
    }
  }
  return count === 1;
}

function isTextInputType(type: string | undefined): boolean {
  const normalized = normalizeType(type ?? '');
  return (
    normalized === 'textfield' ||
    normalized === 'textview' ||
    normalized === 'searchfield' ||
    normalized === 'textarea'
  );
}

function pruneGroupNodes(nodes: RawSnapshotNode[]): RawSnapshotNode[] {
  const skippedDepths: number[] = [];
  const result: RawSnapshotNode[] = [];
  for (const node of nodes) {
    const depth = node.depth ?? 0;
    while (skippedDepths.length > 0 && depth <= skippedDepths[skippedDepths.length - 1]) {
      skippedDepths.pop();
    }
    const type = normalizeType(node.type ?? '');
    const labelCandidate = [node.label, node.value, node.identifier]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .find((value) => value && value.length > 0);
    const hasMeaningfulLabel = labelCandidate ? isMeaningfulLabel(labelCandidate) : false;
    if ((type === 'group' || type === 'ioscontentgroup') && !hasMeaningfulLabel) {
      skippedDepths.push(depth);
      continue;
    }
    const adjustedDepth = Math.max(0, depth - skippedDepths.length);
    result.push({ ...node, depth: adjustedDepth });
  }
  return result;
}

function normalizeType(type: string): string {
  let value = type.replace(/XCUIElementType/gi, '').toLowerCase();
  if (value.startsWith('ax')) {
    value = value.replace(/^ax/, '');
  }
  return value;
}

function findNearestHittableAncestor(
  nodes: SnapshotState['nodes'],
  node: SnapshotState['nodes'][number],
): SnapshotState['nodes'][number] | null {
  if (node.hittable) return node;
  let current = node;
  const visited = new Set<string>();
  while (current.parentIndex !== undefined) {
    if (visited.has(current.ref)) break;
    visited.add(current.ref);
    const parent = nodes[current.parentIndex];
    if (!parent) break;
    if (parent.hittable) return parent;
    current = parent;
  }
  return null;
}

function readVersion(): string {
  try {
    const root = findProjectRoot();
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function findProjectRoot(): string {
  const start = path.dirname(fileURLToPath(import.meta.url));
  let current = start;
  for (let i = 0; i < 6; i += 1) {
    const pkgPath = path.join(current, 'package.json');
    if (fs.existsSync(pkgPath)) return current;
    current = path.dirname(current);
  }
  return start;
}
