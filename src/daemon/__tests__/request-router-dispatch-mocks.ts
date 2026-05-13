import { vi } from 'vitest';

const dispatchMocks = vi.hoisted(() => ({
  resolveTargetDevice: vi.fn(),
}));

vi.mock('../../core/dispatch-resolve.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/dispatch-resolve.ts')>();
  return {
    ...actual,
    resolveTargetDevice: dispatchMocks.resolveTargetDevice,
  };
});

vi.mock('../../core/dispatch.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/dispatch.ts')>();
  return {
    ...actual,
    dispatchCommand: vi.fn(async () => ({})),
    resolveTargetDevice: dispatchMocks.resolveTargetDevice,
  };
});

export function getResolveTargetDeviceMock(): typeof dispatchMocks.resolveTargetDevice {
  return dispatchMocks.resolveTargetDevice;
}
