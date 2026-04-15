import type { BackendCommandContext } from '../backend.ts';
import type { AgentDeviceRuntime, CommandContext } from '../runtime.ts';

export { findNodeByLabel, resolveRefLabel } from '../daemon/snapshot-processing.ts';

export function shouldScopeFind(locator: string): boolean {
  return locator === 'text' || locator === 'label' || locator === 'any';
}

export function toBackendContext(
  runtime: Pick<AgentDeviceRuntime, 'signal'>,
  options: CommandContext,
): BackendCommandContext {
  return {
    session: options.session,
    requestId: options.requestId,
    signal: options.signal ?? runtime.signal,
    metadata: options.metadata,
  };
}

export function now(runtime: AgentDeviceRuntime): number {
  return runtime.clock?.now() ?? Date.now();
}

export async function sleep(runtime: AgentDeviceRuntime, ms: number): Promise<void> {
  if (runtime.clock) await runtime.clock.sleep(ms);
  else await new Promise((resolve) => setTimeout(resolve, ms));
}
