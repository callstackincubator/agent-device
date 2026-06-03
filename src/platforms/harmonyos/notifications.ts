import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { runHarmonyHdc } from './hdc.ts';

type HarmonyBroadcastPayload = {
  action?: string;
  ability?: string;
  extras?: Record<string, unknown>;
};

export async function pushHarmonyNotification(
  device: DeviceInfo,
  bundleName: string,
  payload: HarmonyBroadcastPayload,
): Promise<{ action: string; extrasCount: number }> {
  const action =
    typeof payload.action === 'string' && payload.action.trim()
      ? payload.action.trim()
      : `${bundleName}.TEST_PUSH`;

  const args = ['shell', 'aa', 'send', '-a', action, '-b', bundleName];

  const ability = typeof payload.ability === 'string' ? payload.ability.trim() : '';
  if (ability) {
    args.push('--ability', ability);
  }

  const rawExtras = payload.extras;
  if (
    rawExtras !== undefined &&
    (typeof rawExtras !== 'object' || rawExtras === null || Array.isArray(rawExtras))
  ) {
    throw new AppError('INVALID_ARGS', 'HarmonyOS push payload extras must be an object');
  }

  const extras = rawExtras ?? {};
  let extrasCount = 0;
  for (const [key, rawValue] of Object.entries(extras)) {
    if (!key) continue;
    appendBroadcastExtra(args, key, rawValue);
    extrasCount += 1;
  }

  await runHarmonyHdc(device, args);
  return { action, extrasCount };
}

function appendBroadcastExtra(args: string[], key: string, value: unknown): void {
  if (typeof value === 'string') {
    args.push('--es', key, value);
    return;
  }
  if (typeof value === 'boolean') {
    args.push('--ez', key, value ? 'true' : 'false');
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isInteger(value)) {
      args.push('--ei', key, String(value));
      return;
    }
    args.push('--ef', key, String(value));
    return;
  }
  throw new AppError(
    'INVALID_ARGS',
    `Unsupported HarmonyOS broadcast extra type for "${key}". Use string, boolean, or number.`,
  );
}
