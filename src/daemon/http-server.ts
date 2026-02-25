import http, { type IncomingHttpHeaders } from 'node:http';
import { AppError, normalizeError } from '../utils/errors.ts';
import type { DaemonRequest, DaemonResponse } from './types.ts';
import { normalizeTenantId } from './config.ts';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: Record<string, unknown>;
  };
};

export type HttpAuthHookContext = {
  headers: IncomingHttpHeaders;
  rpcRequest: JsonRpcRequest;
  daemonRequest: DaemonRequest;
};

export type HttpAuthHookResult =
  | boolean
  | void
  | {
    ok?: boolean;
    tenantId?: string;
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };

export type HttpAuthHook = (context: HttpAuthHookContext) => Promise<HttpAuthHookResult> | HttpAuthHookResult;

type HttpAuthDecision =
  | { ok: true; tenantId?: string }
  | { ok: false; statusCode: number; response: JsonRpcResponse };

const MAX_HTTP_RPC_BODY_BYTES = 1024 * 1024;
const COMMAND_RPC_METHODS = new Set(['agent_device.command', 'agent-device.command']);
const LEASE_RPC_METHOD_TO_COMMAND: Record<string, 'lease_allocate' | 'lease_heartbeat' | 'lease_release'> = {
  'agent_device.lease.allocate': 'lease_allocate',
  'agent-device.lease.allocate': 'lease_allocate',
  'agent_device.lease.heartbeat': 'lease_heartbeat',
  'agent-device.lease.heartbeat': 'lease_heartbeat',
  'agent_device.lease.release': 'lease_release',
  'agent-device.lease.release': 'lease_release',
};
const SUPPORTED_RPC_METHODS = new Set([
  ...COMMAND_RPC_METHODS,
  ...Object.keys(LEASE_RPC_METHOD_TO_COMMAND),
]);

function createRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: Record<string, unknown>,
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, data },
  };
}

function sendJson(res: http.ServerResponse<http.IncomingMessage>, response: JsonRpcResponse, httpCode: number = 200): void {
  res.statusCode = httpCode;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(response));
}

function statusCodeForNormalizedError(code: string): number {
  switch (code) {
    case 'INVALID_ARGS':
      return 400;
    case 'UNAUTHORIZED':
      return 401;
    case 'SESSION_NOT_FOUND':
      return 404;
    default:
      return 500;
  }
}

function resolveToken(
  params: Record<string, unknown>,
  headers: IncomingHttpHeaders,
): string {
  const authHeader = typeof headers.authorization === 'string' ? headers.authorization : '';
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice('bearer '.length) : undefined;
  const headerToken = typeof headers['x-agent-device-token'] === 'string' ? headers['x-agent-device-token'] : undefined;
  const paramToken = typeof params.token === 'string' ? params.token : undefined;
  return paramToken ?? headerToken ?? bearerToken ?? '';
}

function toDaemonRequest(params: Partial<DaemonRequest>, headers: IncomingHttpHeaders): DaemonRequest {
  const raw = params as Record<string, unknown>;
  return {
    token: resolveToken(raw, headers),
    session: params.session ?? 'default',
    command: params.command ?? '',
    positionals: Array.isArray(params.positionals) ? params.positionals : [],
    flags: params.flags,
    meta: params.meta,
  };
}

function readStringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
}

function readIntParam(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  return Number.isInteger(value) ? Number(value) : undefined;
}

function toLeaseDaemonRequest(
  command: 'lease_allocate' | 'lease_heartbeat' | 'lease_release',
  params: Record<string, unknown>,
  headers: IncomingHttpHeaders,
): DaemonRequest {
  return {
    token: resolveToken(params, headers),
    session: readStringParam(params, 'session') ?? 'default',
    command,
    positionals: [],
    meta: {
      tenantId: readStringParam(params, 'tenantId') ?? readStringParam(params, 'tenant'),
      runId: readStringParam(params, 'runId'),
      leaseId: readStringParam(params, 'leaseId'),
      leaseTtlMs: readIntParam(params, 'ttlMs'),
      leaseBackend: readStringParam(params, 'backend') as 'ios-simulator' | undefined,
    },
  };
}

function methodToDaemonRequest(
  method: string,
  params: Record<string, unknown>,
  headers: IncomingHttpHeaders,
): DaemonRequest {
  if (COMMAND_RPC_METHODS.has(method)) {
    return toDaemonRequest(params as unknown as Partial<DaemonRequest>, headers);
  }
  const leaseCommand = LEASE_RPC_METHOD_TO_COMMAND[method];
  if (leaseCommand) {
    return toLeaseDaemonRequest(leaseCommand, params, headers);
  }
  throw new AppError('INVALID_ARGS', `Method not found: ${method}`);
}

function isCommandRpcMethod(method: string): boolean {
  return COMMAND_RPC_METHODS.has(method);
}

async function runHttpAuthHook(
  authHook: HttpAuthHook | null,
  context: HttpAuthHookContext,
): Promise<HttpAuthDecision> {
  if (!authHook) return { ok: true };
  const result = await authHook(context);
  if (result === undefined || result === true) return { ok: true };
  if (result === false) {
    const normalized = normalizeError(new AppError('UNAUTHORIZED', 'Request rejected by auth hook'));
    return {
      ok: false,
      statusCode: 401,
      response: createRpcError(context.rpcRequest.id ?? null, -32001, normalized.message, normalized),
    };
  }
  if (result.ok === false) {
    const normalized = normalizeError(
      new AppError(result.code as any ?? 'UNAUTHORIZED', result.message ?? 'Request rejected by auth hook', result.details),
    );
    return {
      ok: false,
      statusCode: 401,
      response: createRpcError(context.rpcRequest.id ?? null, -32001, normalized.message, normalized),
    };
  }
  if (typeof result.tenantId === 'string' && result.tenantId.length > 0) {
    const tenantId = normalizeTenantId(result.tenantId);
    if (!tenantId) {
      const normalized = normalizeError(
        new AppError('INVALID_ARGS', 'Auth hook returned invalid tenantId'),
      );
      return {
        ok: false,
        statusCode: 500,
        response: createRpcError(context.rpcRequest.id ?? null, -32000, normalized.message, normalized),
      };
    }
    return { ok: true, tenantId };
  }
  return { ok: true };
}

async function loadHttpAuthHook(): Promise<HttpAuthHook | null> {
  const hookPath = process.env.AGENT_DEVICE_HTTP_AUTH_HOOK;
  if (!hookPath) return null;
  const exportName = process.env.AGENT_DEVICE_HTTP_AUTH_EXPORT || 'default';
  const resolvedPath = path.isAbsolute(hookPath) ? hookPath : path.resolve(hookPath);
  let imported: Record<string, unknown>;
  try {
    imported = await import(pathToFileURL(resolvedPath).href) as Record<string, unknown>;
  } catch (error) {
    throw new AppError('COMMAND_FAILED', 'Failed to load AGENT_DEVICE_HTTP_AUTH_HOOK module', {
      hookPath: resolvedPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const maybeHook = imported[exportName];
  if (typeof maybeHook !== 'function') {
    throw new AppError('INVALID_ARGS', `Auth hook export ${exportName} is not a function`, {
      hookPath: resolvedPath,
      exportName,
    });
  }
  return maybeHook as HttpAuthHook;
}

export async function createDaemonHttpServer(options: {
  handleRequest: (req: DaemonRequest) => Promise<DaemonResponse>;
}): Promise<http.Server> {
  const authHook = await loadHttpAuthHook();
  const { handleRequest } = options;
  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method !== 'POST' || req.url !== '/rpc') {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }

    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_HTTP_RPC_BODY_BYTES) {
        req.destroy(new Error('request too large'));
      }
    });

    req.on('error', () => {
      if (!res.headersSent) {
        sendJson(res, createRpcError(null, -32700, 'Parse error'), 400);
      }
    });

    req.on('end', async () => {
      let rpcRequest: JsonRpcRequest;
      try {
        rpcRequest = JSON.parse(body) as JsonRpcRequest;
      } catch {
        sendJson(res, createRpcError(null, -32700, 'Parse error'), 400);
        return;
      }

      if (rpcRequest.jsonrpc !== '2.0' || typeof rpcRequest.method !== 'string') {
        sendJson(res, createRpcError(rpcRequest.id ?? null, -32600, 'Invalid Request'), 400);
        return;
      }
      if (!SUPPORTED_RPC_METHODS.has(rpcRequest.method)) {
        sendJson(res, createRpcError(rpcRequest.id ?? null, -32601, `Method not found: ${rpcRequest.method}`), 404);
        return;
      }
      if (!rpcRequest.params || typeof rpcRequest.params !== 'object') {
        sendJson(res, createRpcError(rpcRequest.id ?? null, -32602, 'Invalid params'), 400);
        return;
      }

      try {
        const params = rpcRequest.params as Record<string, unknown>;
        const daemonRequest = methodToDaemonRequest(rpcRequest.method, params, req.headers);
        if (
          isCommandRpcMethod(rpcRequest.method)
          && (typeof daemonRequest.command !== 'string' || daemonRequest.command.length === 0)
        ) {
          sendJson(res, createRpcError(rpcRequest.id ?? null, -32602, 'Invalid params: command is required'), 400);
          return;
        }

        const authResult = await runHttpAuthHook(authHook, {
          headers: req.headers,
          rpcRequest,
          daemonRequest,
        });
        if (!authResult.ok) {
          sendJson(res, authResult.response, authResult.statusCode);
          return;
        }
        if (authResult.tenantId) {
          daemonRequest.meta = {
            ...daemonRequest.meta,
            tenantId: authResult.tenantId,
            sessionIsolation: daemonRequest.meta?.sessionIsolation ?? daemonRequest.flags?.sessionIsolation ?? 'tenant',
          };
        }

        const daemonResponse = await handleRequest(daemonRequest);
        if (daemonResponse.ok) {
          sendJson(res, { jsonrpc: '2.0', id: rpcRequest.id ?? null, result: daemonResponse });
          return;
        }
        sendJson(
          res,
          createRpcError(
            rpcRequest.id ?? null,
            -32000,
            daemonResponse.error.message,
            daemonResponse.error,
          ),
          statusCodeForNormalizedError(daemonResponse.error.code),
        );
      } catch (error) {
        const normalized = normalizeError(error);
        sendJson(
          res,
          createRpcError(rpcRequest.id ?? null, -32000, normalized.message, normalized),
          statusCodeForNormalizedError(normalized.code),
        );
      }
    });
  });
}
