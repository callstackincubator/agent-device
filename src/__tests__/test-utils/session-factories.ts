import type { SessionState } from '../../daemon/types.ts';
import { IOS_SIMULATOR, ANDROID_EMULATOR, MACOS_DEVICE } from './device-fixtures.ts';

export function makeSession(name: string, overrides?: Partial<SessionState>): SessionState {
  return {
    name,
    device: IOS_SIMULATOR,
    createdAt: Date.now(),
    actions: [],
    ...overrides,
  };
}

export function makeIosSession(name: string, overrides?: Partial<SessionState>): SessionState {
  return makeSession(name, { device: IOS_SIMULATOR, ...overrides });
}

export function makeAndroidSession(name: string, overrides?: Partial<SessionState>): SessionState {
  return makeSession(name, { device: ANDROID_EMULATOR, ...overrides });
}

export function makeMacOsSession(name: string, overrides?: Partial<SessionState>): SessionState {
  return makeSession(name, { device: MACOS_DEVICE, ...overrides });
}
