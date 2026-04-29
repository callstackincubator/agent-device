import { type BatchInvoke, runBatch } from '../../core/batch.ts';
import type { DaemonRequest, DaemonResponse } from '../types.ts';

export async function runBatchCommands(
  req: DaemonRequest,
  sessionName: string,
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>,
): Promise<DaemonResponse> {
  return await runBatch(req, sessionName, invoke as BatchInvoke);
}
