import net from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { AppError, normalizeError } from '../utils/errors.ts';
import type { DaemonRequest, DaemonResponse } from './types.ts';
import { abortAllIosRunnerSessions } from '../platforms/ios/runner-client.ts';
import {
  clearRequestCanceled,
  createRequestCanceledError,
  isRequestCanceled,
  markRequestCanceled,
  registerRequestAbort,
  resolveRequestTrackingId,
} from './request-cancel.ts';
import { emitDiagnostic } from '../utils/diagnostics.ts';

const disconnectAbortPollIntervalMs = 200;
const disconnectAbortMaxWindowMs = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createSocketServer(
  handleRequest: (req: DaemonRequest) => Promise<DaemonResponse>,
): net.Server {
  return net.createServer((socket) => {
    let buffer = '';
    let inFlightRequests = 0;
    const activeRequestIds = new Set<string>();
    let canceledInFlight = false;
    const cancelInFlightRunnerSessions = () => {
      if (canceledInFlight || inFlightRequests === 0) return;
      canceledInFlight = true;
      for (const requestId of activeRequestIds) {
        markRequestCanceled(requestId);
      }
      emitDiagnostic({
        level: 'warn',
        phase: 'request_client_disconnected',
        data: {
          inFlightRequests,
        },
      });
      void (async () => {
        try {
          const deadline = Date.now() + disconnectAbortMaxWindowMs;
          while (inFlightRequests > 0 && Date.now() < deadline) {
            await abortAllIosRunnerSessions();
            if (inFlightRequests <= 0) break;
            await sleep(disconnectAbortPollIntervalMs);
          }
        } catch (err) {
          emitDiagnostic({
            level: 'error',
            phase: 'request_client_disconnect_abort_failed',
            data: {
              message: err instanceof Error ? err.message : String(err),
              inFlightRequests,
            },
          });
        }
      })();
    };
    socket.setEncoding('utf8');
    socket.on('close', cancelInFlightRunnerSessions);
    socket.on('error', cancelInFlightRunnerSessions);
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
        inFlightRequests += 1;
        let requestIdForCleanup: string | undefined;
        try {
          const req = JSON.parse(line) as DaemonRequest;
          requestIdForCleanup = resolveRequestTrackingId(req.meta?.requestId, 'socket');
          req.meta = {
            ...req.meta,
            requestId: requestIdForCleanup,
          };
          activeRequestIds.add(requestIdForCleanup);
          registerRequestAbort(requestIdForCleanup);
          if (isRequestCanceled(requestIdForCleanup)) {
            throw createRequestCanceledError();
          }
          response = await handleRequest(req);
        } catch (err) {
          response = { ok: false, error: normalizeError(err) };
        } finally {
          inFlightRequests -= 1;
          if (requestIdForCleanup) {
            activeRequestIds.delete(requestIdForCleanup);
            clearRequestCanceled(requestIdForCleanup);
          }
        }
        if (!socket.destroyed) {
          socket.write(`${JSON.stringify(response)}\n`);
        }
        idx = buffer.indexOf('\n');
      }
    });
  });
}

export function listenNetServer(server: net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (typeof address === 'object' && address?.port) {
        resolve(address.port);
        return;
      }
      reject(new AppError('COMMAND_FAILED', 'Failed to bind socket server'));
    });
  });
}

export function listenHttpServer(server: HttpServer): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (typeof address === 'object' && address?.port) {
        resolve(address.port);
        return;
      }
      reject(new AppError('COMMAND_FAILED', 'Failed to bind HTTP server'));
    });
  });
}
