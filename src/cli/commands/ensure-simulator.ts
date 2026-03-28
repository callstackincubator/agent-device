import { printJson } from '../../utils/output.ts';
import { AppError } from '../../utils/errors.ts';
import { serializeEnsureSimulatorResult } from '../../cli-serializers.ts';
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
  if (flags.json) {
    printJson({ success: true, data });
  } else {
    const action = result.created ? 'Created' : 'Reused';
    const bootedSuffix = result.booted ? ' (booted)' : '';
    process.stdout.write(`${action}: ${result.device} ${result.udid}${bootedSuffix}\n`);
    if (result.runtime) process.stdout.write(`Runtime: ${result.runtime}\n`);
  }
  return true;
};
