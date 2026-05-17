import {
  closeLoopbackServer,
  listenOnLoopback,
  supportsLoopbackBind,
} from '../../../src/__tests__/test-utils/loopback.ts';

type SkippableTestContext = {
  skip(reason?: string): void;
};

function requiresLoopbackCoverage(): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    (process.env.AGENT_DEVICE_REQUIRE_LOOPBACK_TESTS ?? '').toLowerCase(),
  );
}

export async function skipWhenLoopbackUnavailable(
  t: SkippableTestContext,
  coverageLabel = 'loopback integration coverage',
): Promise<boolean> {
  if (await supportsLoopbackBind()) {
    return false;
  }
  if (requiresLoopbackCoverage()) {
    throw new Error(`loopback listeners are required for ${coverageLabel}`);
  }
  t.skip('loopback listeners are not permitted in this environment');
  return true;
}

export const listenHttpOnLoopback = listenOnLoopback;
export const closeServer = closeLoopbackServer;
export const closeHttpServer = closeLoopbackServer;
