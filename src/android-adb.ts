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
