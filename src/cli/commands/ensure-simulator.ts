import { AppError } from '../../utils/errors.ts';
import { serializeEnsureSimulatorResult } from '../../client-shared.ts';
import { writeCommandOutput } from './shared.ts';
import type { ClientCommandHandler } from './router.ts';

export const ensureSimulatorCommand: ClientCommandHandler = async ({ flags, client }) => {
  if (!flags.device) {
    throw new AppError('INVALID_ARGS', 'ensure-simulator requires --device <name>');
  }
  const result = await client.simulators.ensure({
    device: flags.device,
    runtime: flags.runtime,
    boot: flags.boot,
    reuseExisting: flags.reuseExisting,
    iosSimulatorDeviceSet: flags.iosSimulatorDeviceSet,
  });
  const data = serializeEnsureSimulatorResult(result);
  writeCommandOutput(flags, data, () => {
    const action = result.created ? 'Created' : 'Reused';
    const bootedSuffix = result.booted ? ' (booted)' : '';
    return result.runtime
      ? `${action}: ${result.device} ${result.udid}${bootedSuffix}\nRuntime: ${result.runtime}`
      : `${action}: ${result.device} ${result.udid}${bootedSuffix}`;
  });
  return true;
};
