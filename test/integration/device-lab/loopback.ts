import http from 'node:http';
import net from 'node:net';

let loopbackBindSupportPromise: Promise<boolean> | null = null;

export async function supportsLoopbackBind(): Promise<boolean> {
  if (loopbackBindSupportPromise) {
    return await loopbackBindSupportPromise;
  }
  loopbackBindSupportPromise = new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.listen(0, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
  return await loopbackBindSupportPromise;
}

export function requiresLoopbackCoverage(): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    (process.env.AGENT_DEVICE_REQUIRE_LOOPBACK_TESTS ?? '').toLowerCase(),
  );
}

export async function listenHttpOnLoopback(server: http.Server): Promise<number> {
  return await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (typeof address === 'object' && address?.port) {
        resolve(address.port);
        return;
      }
      reject(new Error('Failed to bind test server'));
    });
  });
}

export async function closeHttpServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
