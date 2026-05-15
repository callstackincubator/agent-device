import type { AndroidAdbExecutor } from '../platforms/android/adb-executor.ts';
import {
  type AndroidAdbProviderResolver,
  withRequestPlatformProviderScope,
} from './request-platform-providers.ts';
import type { DaemonRequest, SessionState } from './types.ts';

export type {
  AndroidAdbProviderResolver,
  PlatformProviderRequestSession as AndroidAdbProviderRequestSession,
} from './request-platform-providers.ts';

/**
 * @deprecated Use withRequestPlatformProviderScope for new request-scoped platform providers.
 * This shim preserves the old Android-only seam while callers migrate to the unified registry.
 */
export async function withRequestAndroidAdbScope<T>(
  params: {
    req: DaemonRequest;
    existingSession: SessionState | undefined;
    androidAdbProvider?: AndroidAdbProviderResolver;
  },
  task: (executor?: AndroidAdbExecutor) => Promise<T>,
): Promise<T> {
  return await withRequestPlatformProviderScope(
    {
      req: params.req,
      existingSession: params.existingSession,
      providers: { androidAdbProvider: params.androidAdbProvider },
    },
    async (scope) => await task(scope.androidAdbExecutor),
  );
}
