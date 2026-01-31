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
import { runIosRunnerCommand, stopIosRunnerSession } from './platforms/ios/runner-client.ts';

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
  actions: SessionAction[];
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
): {
  appBundleId?: string;
  verbose?: boolean;
  logPath?: string;
  snapshotInteractiveOnly?: boolean;
  snapshotCompact?: boolean;
  snapshotDepth?: number;
  snapshotScope?: string;
  snapshotBackend?: 'ax' | 'xctest';
} {
  return {
    appBundleId,
    verbose: flags?.verbose,
    logPath,
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

  if (command === 'open') {
    const device = await resolveTargetDevice(req.flags ?? {});
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
        ...contextFromFlags(req.flags, session.appBundleId),
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
    const appBundleId = session?.appBundleId;
    const data = (await dispatchCommand(device, 'snapshot', [], req.flags?.out, {
      ...contextFromFlags(req.flags, appBundleId),
    })) as {
      nodes?: RawSnapshotNode[];
      truncated?: boolean;
      backend?: 'ax' | 'xctest' | 'android';
      rootRect?: { width: number; height: number };
    };
    const pruned = pruneGroupNodes(data?.nodes ?? []);
    const nodes = attachRefs(pruned);
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
      appBundleId,
      snapshot,
      actions: session?.actions ?? [],
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
        appName: session?.appName ?? appBundleId ?? device.name,
        appBundleId: appBundleId,
      },
    };
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
    const label = node.label?.trim();
    if (
      session.device.platform === 'ios' &&
      session.device.kind === 'simulator' &&
      label &&
      isLabelUnique(session.snapshot.nodes, label)
    ) {
      await runIosRunnerCommand(
        session.device,
        { command: 'tap', text: label, appBundleId: session.appBundleId },
        { verbose: req.flags?.verbose, logPath },
      );
      recordAction(session, {
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: { ref, refLabel: label, mode: 'text' },
      });
      return { ok: true, data: { ref, mode: 'text' } };
    }
    const { x, y } = centerOfRect(node.rect);
    await dispatchCommand(session.device, 'press', [String(x), String(y)], req.flags?.out, {
      ...contextFromFlags(req.flags, session.appBundleId),
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
      const { x, y } = centerOfRect(node.rect);
      const data = await dispatchCommand(
        session.device,
        'fill',
        [String(x), String(y), text],
        req.flags?.out,
        {
          ...contextFromFlags(req.flags, session.appBundleId),
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

  if (command === 'rect') {
    const session = sessions.get(sessionName);
    if (!session?.snapshot) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'No snapshot in session. Run snapshot first.' } };
    }
    const target = req.positionals?.[0] ?? '';
    const ref = normalizeRef(target);
    let label = '';
    if (ref) {
      const node = findNodeByRef(session.snapshot.nodes, ref);
      label = node?.label?.trim() ?? '';
    } else {
      label = req.positionals.join(' ').trim();
    }
    if (!label) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'rect requires a label or ref with label' } };
    }
    if (session.device.platform !== 'ios' || session.device.kind !== 'simulator') {
      return { ok: false, error: { code: 'UNSUPPORTED_OPERATION', message: 'rect is only supported on iOS simulators' } };
    }
    const data = await runIosRunnerCommand(
      session.device,
      { command: 'rect', text: label, appBundleId: session.appBundleId },
      { verbose: req.flags?.verbose, logPath },
    );
    recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { label, rect: data?.rect },
    });
    return { ok: true, data: { label, rect: data?.rect } };
  }

  const session = sessions.get(sessionName);
  if (!session) {
    return {
      ok: false,
      error: { code: 'SESSION_NOT_FOUND', message: 'No active session. Run open first.' },
    };
  }

  const data = await dispatchCommand(session.device, command, req.positionals ?? [], req.flags?.out, {
    ...contextFromFlags(req.flags, session.appBundleId),
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
    noRecord,
    recordJson,
  };
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

function pruneGroupNodes(nodes: RawSnapshotNode[]): RawSnapshotNode[] {
  const skippedDepths: number[] = [];
  const result: RawSnapshotNode[] = [];
  for (const node of nodes) {
    const depth = node.depth ?? 0;
    while (skippedDepths.length > 0 && depth <= skippedDepths[skippedDepths.length - 1]) {
      skippedDepths.pop();
    }
    const type = normalizeType(node.type ?? '');
    if (type === 'group' || type === 'ioscontentgroup') {
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
