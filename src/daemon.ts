import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dispatchCommand, type CommandFlags } from './core/dispatch.ts';
import { isCommandSupportedOnDevice } from './core/capabilities.ts';
import { asAppError, AppError } from './utils/errors.ts';
import { centerOfRect, findNodeByRef, normalizeRef } from './utils/snapshot.ts';
import { stopIosRunnerSession } from './platforms/ios/runner-client.ts';
import type { DaemonRequest, DaemonResponse } from './daemon/types.ts';
import { SessionStore } from './daemon/session-store.ts';
import { contextFromFlags as contextFromFlagsWithLog } from './daemon/context.ts';
import { handleSessionCommands } from './daemon/handlers/session.ts';
import { handleSnapshotCommands } from './daemon/handlers/snapshot.ts';
import { handleFindCommands } from './daemon/handlers/find.ts';
import { handleRecordTraceCommands } from './daemon/handlers/record-trace.ts';
import { findNodeByLabel, isFillableType, resolveRefLabel } from './daemon/snapshot-processing.ts';
import { assertSessionSelectorMatches } from './daemon/session-selector.ts';
import { resolveEffectiveSessionName } from './daemon/session-routing.ts';

const baseDir = path.join(os.homedir(), '.agent-device');
const infoPath = path.join(baseDir, 'daemon.json');
const logPath = path.join(baseDir, 'daemon.log');
const sessionsDir = path.join(baseDir, 'sessions');
const sessionStore = new SessionStore(sessionsDir);
const version = readVersion();
const token = crypto.randomBytes(24).toString('hex');
const selectorValidationExemptCommands = new Set(['session_list', 'devices']);

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
  return contextFromFlagsWithLog(logPath, flags, appBundleId, traceLogPath);
}

async function handleRequest(req: DaemonRequest): Promise<DaemonResponse> {
  if (req.token !== token) {
    return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } };
  }

  const command = req.command;
  const sessionName = resolveEffectiveSessionName(req, sessionStore);
  const existingSession = sessionStore.get(sessionName);
  if (existingSession && !selectorValidationExemptCommands.has(command)) {
    assertSessionSelectorMatches(existingSession, req.flags);
  }

  const sessionResponse = await handleSessionCommands({
    req,
    sessionName,
    logPath,
    sessionStore,
    invoke: handleRequest,
  });
  if (sessionResponse) return sessionResponse;

  const snapshotResponse = await handleSnapshotCommands({
    req,
    sessionName,
    logPath,
    sessionStore,
  });
  if (snapshotResponse) return snapshotResponse;

  const recordTraceResponse = await handleRecordTraceCommands({
    req,
    sessionName,
    sessionStore,
  });
  if (recordTraceResponse) return recordTraceResponse;

  const findResponse = await handleFindCommands({
    req,
    sessionName,
    logPath,
    sessionStore,
    invoke: handleRequest,
  });
  if (findResponse) return findResponse;

  if (command === 'click') {
    const session = sessionStore.get(sessionName);
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
    sessionStore.recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { ref, x, y, refLabel },
    });
    return { ok: true, data: { ref, x, y } };
  }

  if (command === 'fill') {
    const session = sessionStore.get(sessionName);
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
      const nodeType = node.type ?? '';
      const fillWarning =
        nodeType && !isFillableType(nodeType, session.device.platform)
          ? `fill target ${req.positionals[0]} resolved to "${nodeType}", attempting fill anyway.`
          : undefined;
      const refLabel = resolveRefLabel(node, session.snapshot.nodes);
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
      const resultPayload: Record<string, unknown> = {
        ...(data ?? { ref, x, y }),
      };
      if (fillWarning) {
        resultPayload.warning = fillWarning;
      }
      sessionStore.recordAction(session, {
        command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: { ...resultPayload, refLabel },
      });
      return { ok: true, data: resultPayload };
    }
  }

  if (command === 'get') {
    const sub = req.positionals?.[0];
    const refInput = req.positionals?.[1];
    if (sub !== 'text' && sub !== 'attrs') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'get only supports text or attrs' } };
    }
    const session = sessionStore.get(sessionName);
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
      sessionStore.recordAction(session, {
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
    sessionStore.recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { ref, text, refLabel: text || undefined },
    });
    return { ok: true, data: { ref, text, node } };
  }


  const session = sessionStore.get(sessionName);
  if (!session) {
    return {
      ok: false,
      error: { code: 'SESSION_NOT_FOUND', message: 'No active session. Run open first.' },
    };
  }

  if (!isCommandSupportedOnDevice(command, session.device)) {
    return {
      ok: false,
      error: { code: 'UNSUPPORTED_OPERATION', message: `${command} is not supported on this device` },
    };
  }

  const data = await dispatchCommand(session.device, command, req.positionals ?? [], req.flags?.out, {
    ...contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
  });
  sessionStore.recordAction(session, {
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
    const sessionsToStop = sessionStore.toArray();
    for (const session of sessionsToStop) {
      if (session.device.platform === 'ios' && session.device.kind === 'simulator') {
        await stopIosRunnerSession(session.device.id);
      }
      sessionStore.writeSessionLog(session);
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
