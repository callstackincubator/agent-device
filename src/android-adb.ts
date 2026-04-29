export {
  createDeviceAdbExecutor,
  resolveAndroidAdbExecutor,
  spawnAndroidAdbBySerial,
  withAndroidAdbProvider,
  type AndroidAdbExecutor,
  type AndroidAdbExecutorOptions,
  type AndroidAdbExecutorResult,
  type AndroidAdbProvider,
  type AndroidAdbSpawner,
} from './platforms/android/adb-executor.ts';
export {
  getAndroidAppStateWithAdb,
  listAndroidAppsWithAdb,
} from './platforms/android/app-helpers.ts';
export type {
  AndroidAppListFilter,
  AndroidAppListOptions,
  AndroidAppListTarget,
} from './platforms/android/app-helpers.ts';
