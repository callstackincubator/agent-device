import { setTimeout as delay } from 'node:timers/promises';
import {
  ENV_BEARER_TOKEN,
  ENV_LAUNCH_URL,
  ENV_LOCAL_BASE_URL,
  ENV_SERVER_BASE_URL,
  METRO_COMPANION_RECONNECT_DELAY_MS,
  METRO_COMPANION_RUN_ARG,
  WS_READY_STATE_OPEN,
} from './client-metro-companion-contract.ts';
import type { CompanionOptions, MetroCompanionRequest } from './client-metro-companion-contract.ts';
import { normalizeBaseUrl } from './utils/url.ts';

function createHeaders(serverBaseUrl: string, token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    ...(serverBaseUrl.includes('ngrok') ? { 'ngrok-skip-browser-warning': '1' } : {}),
  };
}

async function registerCompanion(options: CompanionOptions): Promise<{ wsUrl: string }> {
  const response = await fetch(
    `${normalizeBaseUrl(options.serverBaseUrl)}/api/metro/companion/register`,
    {
      method: 'POST',
      headers: createHeaders(options.serverBaseUrl, options.bearerToken),
      body: JSON.stringify({
        local_base_url: normalizeBaseUrl(options.localBaseUrl),
        ...(options.launchUrl ? { launch_url: options.launchUrl } : {}),
      }),
    },
  );
  const payload = (await response.json()) as {
    ok?: boolean;
    data?: { ws_url?: string };
  };
  if (!response.ok || payload.ok !== true || typeof payload.data?.ws_url !== 'string') {
    throw new Error(`Failed to register Metro companion: ${JSON.stringify(payload)}`);
  }
  return { wsUrl: payload.data.ws_url };
}

async function bufferFromWebSocketData(data: unknown): Promise<Buffer> {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return Buffer.from(await data.arrayBuffer());
  }
  return Buffer.from(String(data), 'utf8');
}

async function parseBridgeMessage(event: MessageEvent): Promise<MetroCompanionRequest> {
  const text = (await bufferFromWebSocketData(event.data)).toString('utf8');
  return JSON.parse(text) as MetroCompanionRequest;
}

function toUpstreamWebSocketUrl(localBaseUrl: string, requestPath: string): string {
  const upstream = new URL(requestPath, `${normalizeBaseUrl(localBaseUrl)}/`);
  upstream.protocol = upstream.protocol === 'https:' ? 'wss:' : 'ws:';
  return upstream.toString();
}

function normalizeCloseCode(code: number | undefined): number {
  if (typeof code !== 'number' || !Number.isInteger(code)) return 1011;
  if (code === 1000) return code;
  if (code >= 3000 && code <= 4999) return code;
  if (code >= 1001 && code <= 1015 && code !== 1004 && code !== 1005 && code !== 1006) {
    return code;
  }
  return 1011;
}

function sendJson(socket: WebSocket, payload: object): void {
  if (socket.readyState !== WS_READY_STATE_OPEN) return;
  socket.send(JSON.stringify(payload));
}

async function waitForSocketOpen(socket: WebSocket, label: string): Promise<void> {
  if (socket.readyState === WS_READY_STATE_OPEN) return;
  await new Promise<void>((resolve, reject) => {
    const handleOpen = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error(`${label} WebSocket failed before opening.`));
    };
    const handleClose = () => {
      cleanup();
      reject(new Error(`${label} WebSocket closed before opening.`));
    };
    const cleanup = () => {
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('error', handleError);
      socket.removeEventListener('close', handleClose);
    };
    socket.addEventListener('open', handleOpen, { once: true });
    socket.addEventListener('error', handleError, { once: true });
    socket.addEventListener('close', handleClose, { once: true });
  });
}

async function waitForSocketShutdown(socket: WebSocket): Promise<void> {
  await new Promise<void>((resolve) => {
    const finish = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      socket.removeEventListener('close', finish);
      socket.removeEventListener('error', finish);
    };
    socket.addEventListener('close', finish, { once: true });
    socket.addEventListener('error', finish, { once: true });
  });
}

function closeSocketQuietly(socket: WebSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    // ignore shutdown races
  }
}

async function handleBridgeMessage(
  bridgeSocket: WebSocket,
  message: MetroCompanionRequest,
  options: CompanionOptions,
  upstreamSockets: Map<string, WebSocket>,
): Promise<void> {
  switch (message.type) {
    case 'ping': {
      sendJson(bridgeSocket, { type: 'pong', timestamp: message.timestamp });
      return;
    }
    case 'http-request': {
      try {
        const response = await fetch(
          new URL(message.path, `${normalizeBaseUrl(options.localBaseUrl)}/`),
          {
            method: message.method,
            headers: message.headers,
            ...(message.bodyBase64 ? { body: Buffer.from(message.bodyBase64, 'base64') } : {}),
          },
        );
        const body = Buffer.from(await response.arrayBuffer());
        sendJson(bridgeSocket, {
          type: 'http-response',
          requestId: message.requestId,
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          ...(body.length > 0 ? { bodyBase64: body.toString('base64') } : {}),
        });
      } catch (error) {
        sendJson(bridgeSocket, {
          type: 'http-error',
          requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    case 'ws-open': {
      const upstreamSocket = new WebSocket(
        toUpstreamWebSocketUrl(options.localBaseUrl, message.path),
      );
      upstreamSocket.binaryType = 'arraybuffer';
      let opened = false;
      upstreamSocket.addEventListener('message', (event) => {
        void (async () => {
          if (!opened) return;
          const payload = await bufferFromWebSocketData(event.data);
          sendJson(bridgeSocket, {
            type: 'ws-frame',
            streamId: message.streamId,
            dataBase64: payload.toString('base64'),
            binary: typeof event.data !== 'string',
          });
        })().catch((error) => {
          console.error(error instanceof Error ? error.message : String(error));
        });
      });
      upstreamSocket.addEventListener('close', (event) => {
        upstreamSockets.delete(message.streamId);
        if (!opened) return;
        sendJson(bridgeSocket, {
          type: 'ws-close',
          streamId: message.streamId,
          code: event.code,
          reason: event.reason,
        });
      });
      upstreamSocket.addEventListener('error', () => {
        if (!opened) return;
        sendJson(bridgeSocket, {
          type: 'ws-close',
          streamId: message.streamId,
          code: 1011,
          reason: 'Upstream WebSocket error.',
        });
      });
      upstreamSockets.set(message.streamId, upstreamSocket);
      try {
        await waitForSocketOpen(upstreamSocket, 'Upstream');
        opened = true;
        sendJson(bridgeSocket, {
          type: 'ws-open-result',
          streamId: message.streamId,
          success: true,
          headers: {},
        });
      } catch (error) {
        upstreamSockets.delete(message.streamId);
        closeSocketQuietly(upstreamSocket, 1011, 'open failed');
        sendJson(bridgeSocket, {
          type: 'ws-open-result',
          streamId: message.streamId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    case 'ws-frame': {
      const upstreamSocket = upstreamSockets.get(message.streamId);
      if (!upstreamSocket || upstreamSocket.readyState !== WS_READY_STATE_OPEN) return;
      const payload = Buffer.from(message.dataBase64, 'base64');
      upstreamSocket.send(message.binary ? payload : payload.toString('utf8'));
      return;
    }
    case 'ws-close': {
      const upstreamSocket = upstreamSockets.get(message.streamId);
      if (!upstreamSocket) return;
      upstreamSockets.delete(message.streamId);
      closeSocketQuietly(
        upstreamSocket,
        normalizeCloseCode(message.code),
        message.reason ?? 'bridge requested close',
      );
      return;
    }
  }
}

export async function runMetroCompanionWorker(options: CompanionOptions): Promise<void> {
  const upstreamSockets = new Map<string, WebSocket>();
  while (true) {
    try {
      const registration = await registerCompanion(options);
      const bridgeSocket = new WebSocket(registration.wsUrl);
      bridgeSocket.binaryType = 'arraybuffer';
      await waitForSocketOpen(bridgeSocket, 'Bridge');
      bridgeSocket.addEventListener('message', (event) => {
        void (async () => {
          const message = await parseBridgeMessage(event);
          await handleBridgeMessage(bridgeSocket, message, options, upstreamSockets);
        })().catch((error) => {
          console.error(error instanceof Error ? error.message : String(error));
        });
      });
      await waitForSocketShutdown(bridgeSocket);
      upstreamSockets.forEach((socket) => closeSocketQuietly(socket, 1012, 'bridge disconnected'));
      upstreamSockets.clear();
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
    await delay(METRO_COMPANION_RECONNECT_DELAY_MS);
  }
}

function readWorkerOptions(argv: string[], env: NodeJS.ProcessEnv): CompanionOptions | null {
  if (argv[0] !== METRO_COMPANION_RUN_ARG) return null;
  const serverBaseUrl = env[ENV_SERVER_BASE_URL]?.trim();
  const bearerToken = env[ENV_BEARER_TOKEN]?.trim();
  const localBaseUrl = env[ENV_LOCAL_BASE_URL]?.trim();
  if (!serverBaseUrl || !bearerToken || !localBaseUrl) {
    throw new Error('Metro companion worker is missing required environment configuration.');
  }
  return {
    serverBaseUrl,
    bearerToken,
    localBaseUrl,
    launchUrl: env[ENV_LAUNCH_URL]?.trim() || undefined,
  };
}

export async function runMetroCompanionProcessFromEnv(
  argv: string[],
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  const options = readWorkerOptions(argv, env);
  if (!options) return false;
  await runMetroCompanionWorker(options);
  return true;
}
