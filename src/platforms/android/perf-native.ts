import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { resolveAndroidAdbExecutor, type AndroidAdbExecutor } from './adb-executor.ts';
import { parseSimpleperfReportEntries } from './perf-native-report.ts';

const ANDROID_SIMPLEPERF_METHOD = 'adb-shell-simpleperf';
const ANDROID_PERFETTO_METHOD = 'adb-shell-perfetto';

const ANDROID_PERF_TIMEOUT_MS = 15_000;
const ANDROID_NATIVE_PROFILE_TIMEOUT_MS = 30_000;
const ANDROID_NATIVE_REMOTE_DIR = '/data/local/tmp';
const ANDROID_PERFETTO_REMOTE_DIR = '/data/misc/perfetto-traces';
const ANDROID_NATIVE_MAX_SECONDS = 60 * 60;

export type AndroidNativePerfOptions = {
  adb?: AndroidAdbExecutor;
};

export type AndroidNativePerfKind = 'simpleperf' | 'perfetto';

export type AndroidNativePerfType = 'cpu-profile' | 'trace';

export type AndroidNativePerfSession = {
  type: AndroidNativePerfType;
  kind: AndroidNativePerfKind;
  packageName: string;
  appPid: string;
  profilerPid: string;
  remotePath: string;
  outPath: string;
  startedAt: number;
  state: 'running' | 'stopped';
  stoppedAt?: number;
  sizeBytes?: number;
};

export type AndroidNativePerfStartResult = AndroidNativePerfSession & {
  action: 'start';
  platform: 'android';
  method: typeof ANDROID_SIMPLEPERF_METHOD | typeof ANDROID_PERFETTO_METHOD;
  message: string;
};

export type AndroidNativePerfStopResult = AndroidNativePerfSession & {
  action: 'stop';
  platform: 'android';
  durationMs: number;
  method: typeof ANDROID_SIMPLEPERF_METHOD | typeof ANDROID_PERFETTO_METHOD;
  artifact: {
    path: string;
    sizeBytes: number;
  };
  message: string;
};

export type AndroidSimpleperfReportResult = {
  action: 'report';
  platform: 'android';
  type: 'cpu-profile-report';
  kind: 'simpleperf';
  packageName: string;
  appPid: string;
  sourceProfilePath: string;
  outPath: string;
  sizeBytes: number;
  generatedAt: string;
  entryCount: number;
  method: typeof ANDROID_SIMPLEPERF_METHOD;
  message: string;
};

export async function startAndroidSimpleperfProfile(
  device: DeviceInfo,
  packageName: string,
  outPath: string,
  options: AndroidNativePerfOptions = {},
): Promise<AndroidNativePerfStartResult> {
  const adb = resolveAndroidAdbExecutor(device, options.adb);
  const appPid = await resolveAndroidAppPid(adb, packageName);
  await assertAndroidToolAvailable(adb, 'simpleperf', packageName);
  const remotePath = buildAndroidNativeRemotePath(packageName, 'cpu.perf.data');
  const profilerPid = await startAndroidBackgroundTool(
    adb,
    buildSimpleperfStartCommand(appPid, remotePath),
    'simpleperf',
    packageName,
  );
  const session = {
    type: 'cpu-profile',
    kind: 'simpleperf',
    packageName,
    appPid,
    profilerPid,
    remotePath,
    outPath,
    startedAt: Date.now(),
    state: 'running',
  } satisfies AndroidNativePerfSession;
  return {
    ...session,
    action: 'start',
    platform: 'android',
    method: ANDROID_SIMPLEPERF_METHOD,
    message: `Started Android Simpleperf CPU profile for ${packageName}`,
  };
}

export async function stopAndroidSimpleperfProfile(
  device: DeviceInfo,
  session: AndroidNativePerfSession,
  outPath: string,
  options: AndroidNativePerfOptions = {},
): Promise<AndroidNativePerfStopResult> {
  return await stopAndroidNativePerfSession(device, { ...session, outPath }, options);
}

export async function writeAndroidSimpleperfReport(
  device: DeviceInfo,
  session: AndroidNativePerfSession,
  outPath: string,
  options: AndroidNativePerfOptions = {},
): Promise<AndroidSimpleperfReportResult> {
  const adb = resolveAndroidAdbExecutor(device, options.adb);
  await assertAndroidToolAvailable(adb, 'simpleperf', session.packageName);
  const report = await runAndroidSimpleperfReport(adb, session);
  const generatedAt = new Date().toISOString();
  const entries = parseSimpleperfReportEntries(report.stdout);
  const payload = {
    kind: 'simpleperf-report',
    generatedAt,
    packageName: session.packageName,
    appPid: session.appPid,
    sourceProfilePath: session.outPath,
    sourceRemotePath: session.remotePath,
    entryCount: entries.length,
    entries,
  };
  await writeJsonArtifact(outPath, payload);
  const sizeBytes = await readFileSize(outPath);
  return {
    action: 'report',
    platform: 'android',
    type: 'cpu-profile-report',
    kind: 'simpleperf',
    packageName: session.packageName,
    appPid: session.appPid,
    sourceProfilePath: session.outPath,
    outPath,
    sizeBytes,
    generatedAt,
    entryCount: entries.length,
    method: ANDROID_SIMPLEPERF_METHOD,
    message: `Wrote Android Simpleperf report for ${session.packageName}`,
  };
}

export async function startAndroidPerfettoTrace(
  device: DeviceInfo,
  packageName: string,
  outPath: string,
  options: AndroidNativePerfOptions = {},
): Promise<AndroidNativePerfStartResult> {
  const adb = resolveAndroidAdbExecutor(device, options.adb);
  const appPid = await resolveAndroidAppPid(adb, packageName);
  await assertAndroidToolAvailable(adb, 'perfetto', packageName);
  const remotePath = buildAndroidNativeRemotePath(
    packageName,
    'app.perfetto-trace',
    ANDROID_PERFETTO_REMOTE_DIR,
  );
  const profilerPid = await startAndroidPerfettoBackgroundTool(adb, remotePath, packageName);
  const session = {
    type: 'trace',
    kind: 'perfetto',
    packageName,
    appPid,
    profilerPid,
    remotePath,
    outPath,
    startedAt: Date.now(),
    state: 'running',
  } satisfies AndroidNativePerfSession;
  return {
    ...session,
    action: 'start',
    platform: 'android',
    method: ANDROID_PERFETTO_METHOD,
    message: `Started Android Perfetto trace for ${packageName}`,
  };
}

export async function stopAndroidPerfettoTrace(
  device: DeviceInfo,
  session: AndroidNativePerfSession,
  outPath: string,
  options: AndroidNativePerfOptions = {},
): Promise<AndroidNativePerfStopResult> {
  return await stopAndroidNativePerfSession(device, { ...session, outPath }, options);
}

async function stopAndroidNativePerfSession(
  device: DeviceInfo,
  session: AndroidNativePerfSession,
  options: AndroidNativePerfOptions,
): Promise<AndroidNativePerfStopResult> {
  const adb = resolveAndroidAdbExecutor(device, options.adb);
  await stopAndroidBackgroundTool(adb, session);
  await pullAndroidNativeArtifact(adb, session);
  const sizeBytes = await readFileSize(session.outPath);
  const stoppedAt = Date.now();
  return {
    ...session,
    action: 'stop',
    platform: 'android',
    state: 'stopped',
    stoppedAt,
    durationMs: Math.max(0, stoppedAt - session.startedAt),
    sizeBytes,
    method: session.kind === 'simpleperf' ? ANDROID_SIMPLEPERF_METHOD : ANDROID_PERFETTO_METHOD,
    artifact: {
      path: session.outPath,
      sizeBytes,
    },
    message: `Stopped Android ${session.kind} ${session.type} for ${session.packageName}`,
  };
}

async function resolveAndroidAppPid(adb: AndroidAdbExecutor, packageName: string): Promise<string> {
  try {
    const result = await adb(['shell', 'pidof', packageName], {
      allowFailure: true,
      timeoutMs: ANDROID_PERF_TIMEOUT_MS,
    });
    const pid = findPidToken(result.stdout);
    if (result.exitCode === 0 && pid) return pid;
  } catch {
    // Fall through to the actionable error below.
  }
  throw new AppError('COMMAND_FAILED', `No active Android app process found for ${packageName}`, {
    package: packageName,
    hint: 'Run open <app> for this session again, wait for the app UI to appear, then retry perf.',
  });
}

async function assertAndroidToolAvailable(
  adb: AndroidAdbExecutor,
  tool: 'simpleperf' | 'perfetto',
  packageName: string,
): Promise<void> {
  const result = await adb(['shell', `command -v ${tool} || which ${tool}`], {
    allowFailure: true,
    timeoutMs: ANDROID_PERF_TIMEOUT_MS,
  });
  if (result.exitCode === 0 && result.stdout.trim()) return;
  throw new AppError('UNSUPPORTED_OPERATION', `Android device does not expose ${tool}`, {
    package: packageName,
    tool,
    hint:
      tool === 'simpleperf'
        ? 'Use an emulator/system image with simpleperf available, or install the Android NDK simpleperf binary for this device.'
        : 'Use Android 10+ or a system image that exposes the perfetto command-line binary.',
  });
}

function buildAndroidNativeRemotePath(
  packageName: string,
  fileName: string,
  remoteDir = ANDROID_NATIVE_REMOTE_DIR,
): string {
  const safePackage = packageName.replace(/[^A-Za-z0-9_.-]/g, '_');
  return `${remoteDir}/agent-device-${safePackage}-${Date.now()}-${fileName}`;
}

function buildSimpleperfStartCommand(appPid: string, remotePath: string): string {
  return buildBackgroundShellCommand(
    [
      'simpleperf',
      'record',
      '-e',
      'cpu-clock:u',
      '-p',
      appPid,
      '-o',
      remotePath,
      '--duration',
      String(ANDROID_NATIVE_MAX_SECONDS),
    ],
    'simpleperf',
  );
}

function buildBackgroundShellCommand(argv: string[], label: string): string {
  const command = argv.map(shellQuote).join(' ');
  const stderrPath = `${ANDROID_NATIVE_REMOTE_DIR}/agent-device-${label}-${Date.now()}.err`;
  return [
    `err=${shellQuote(stderrPath)}`,
    `(${command}) >/dev/null 2>"$err" & pid=$!`,
    'sleep 1',
    'if kill -0 "$pid" 2>/dev/null; then echo "$pid"; exit 0; fi',
    'cat "$err" >&2',
    'rm -f "$err"',
    'exit 1',
  ].join('; ');
}

async function startAndroidPerfettoBackgroundTool(
  adb: AndroidAdbExecutor,
  remotePath: string,
  packageName: string,
): Promise<string> {
  try {
    const result = await adb(
      [
        'shell',
        'perfetto',
        '--background-wait',
        '-o',
        remotePath,
        '-t',
        `${ANDROID_NATIVE_MAX_SECONDS}s`,
        'sched',
        'freq',
        'idle',
        'am',
        'wm',
        'gfx',
        'view',
        'binder_driver',
        'hal',
        'dalvik',
      ],
      {
        timeoutMs: ANDROID_NATIVE_PROFILE_TIMEOUT_MS,
      },
    );
    const pid = findPidToken(result.stdout);
    if (pid) return pid;
    throw new AppError('COMMAND_FAILED', 'Android perfetto did not return a profiler pid', {
      package: packageName,
      tool: 'perfetto',
      hint: 'Retry perf trace start. If perfetto exits immediately, verify the device permits trace capture.',
    });
  } catch (error) {
    throw annotateAndroidNativePerfError('start', 'perfetto', packageName, error);
  }
}

async function startAndroidBackgroundTool(
  adb: AndroidAdbExecutor,
  shellCommand: string,
  tool: AndroidNativePerfKind,
  packageName: string,
): Promise<string> {
  try {
    const result = await adb(['shell', shellCommand], {
      timeoutMs: ANDROID_NATIVE_PROFILE_TIMEOUT_MS,
    });
    const pid = findPidToken(result.stdout);
    if (pid) return pid;
    throw new AppError('COMMAND_FAILED', `Android ${tool} did not return a profiler pid`, {
      package: packageName,
      tool,
      hint: `Retry perf. If ${tool} exits immediately, verify the app is profileable and the device permits native profiling.`,
    });
  } catch (error) {
    throw annotateAndroidNativePerfError('start', tool, packageName, error);
  }
}

async function stopAndroidBackgroundTool(
  adb: AndroidAdbExecutor,
  session: AndroidNativePerfSession,
): Promise<void> {
  try {
    await adb(['shell', buildStopProfilerCommand(session.profilerPid)], {
      allowFailure: true,
      timeoutMs: ANDROID_NATIVE_PROFILE_TIMEOUT_MS,
    });
  } catch (error) {
    throw annotateAndroidNativePerfError('stop', session.kind, session.packageName, error);
  }
}

function buildStopProfilerCommand(pid: string): string {
  return [
    `pid=${shellQuote(pid)}`,
    'kill -INT "$pid" 2>/dev/null || true',
    'for i in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || exit 0; sleep 0.2; done',
    'kill -TERM "$pid" 2>/dev/null || true',
  ].join('; ');
}

function findPidToken(stdout: string): string | undefined {
  return stdout
    .trim()
    .split(/\s+/)
    .find((token) => /^\d+$/.test(token));
}

async function pullAndroidNativeArtifact(
  adb: AndroidAdbExecutor,
  session: AndroidNativePerfSession,
): Promise<void> {
  await fs.mkdir(path.dirname(session.outPath), { recursive: true });
  try {
    await adb(['pull', session.remotePath, session.outPath], {
      timeoutMs: ANDROID_NATIVE_PROFILE_TIMEOUT_MS,
    });
  } catch (error) {
    throw new AppError(
      'COMMAND_FAILED',
      `Failed to pull Android ${session.kind} artifact for ${session.packageName}`,
      {
        package: session.packageName,
        tool: session.kind,
        remotePath: session.remotePath,
        outPath: session.outPath,
        hint: 'Check that the profiling command ran long enough to create an artifact, then retry stop with the same session.',
      },
      error,
    );
  }
}

async function runAndroidSimpleperfReport(
  adb: AndroidAdbExecutor,
  session: AndroidNativePerfSession,
): Promise<{ stdout: string }> {
  try {
    return await adb(
      [
        'shell',
        'simpleperf',
        'report',
        '-i',
        session.remotePath,
        '--stdio',
        '--sort',
        'comm,dso,symbol',
      ],
      {
        timeoutMs: ANDROID_NATIVE_PROFILE_TIMEOUT_MS,
      },
    );
  } catch (error) {
    throw annotateAndroidNativePerfError('report', 'simpleperf', session.packageName, error);
  }
}

async function writeJsonArtifact(outPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readFileSize(filePath: string): Promise<number> {
  try {
    return (await fs.stat(filePath)).size;
  } catch (error) {
    throw new AppError(
      'COMMAND_FAILED',
      `Profiler artifact was not written: ${filePath}`,
      {
        outPath: filePath,
        hint: 'Retry the profiling command and check daemon logs if the artifact path is still missing.',
      },
      error,
    );
  }
}

function annotateAndroidNativePerfError(
  action: 'start' | 'stop' | 'report',
  tool: AndroidNativePerfKind,
  packageName: string,
  error: unknown,
): AppError {
  if (error instanceof AppError) {
    const details = error.details ?? {};
    return new AppError(
      error.code,
      error.message,
      {
        ...details,
        action,
        package: packageName,
        tool,
        hint:
          typeof details.hint === 'string'
            ? details.hint
            : classifyAndroidNativePerfHint(tool, details),
      },
      error,
    );
  }
  return new AppError(
    'COMMAND_FAILED',
    `Failed to ${action} Android ${tool} for ${packageName}`,
    {
      action,
      package: packageName,
      tool,
      hint: buildAndroidNativePerfHint(tool),
    },
    error,
  );
}

function buildAndroidNativePerfHint(tool: AndroidNativePerfKind): string {
  return tool === 'simpleperf'
    ? 'Verify simpleperf is available, the app process is running, and the app/device permits native CPU profiling.'
    : 'Verify perfetto is available, the app process is running, and the device permits trace capture.';
}

function classifyAndroidNativePerfHint(
  tool: AndroidNativePerfKind,
  details: Record<string, unknown>,
): string {
  const stderr = typeof details.stderr === 'string' ? details.stderr : '';
  const text = stderr.toLowerCase();
  if (tool === 'simpleperf') return classifySimpleperfHint(text);
  if (hasPerfettoPermissionError(text)) {
    return 'Use a device image that permits perfetto trace capture for shell, keep the app running, then retry perf trace start.';
  }
  return buildAndroidNativePerfHint(tool);
}

function classifySimpleperfHint(text: string): string {
  if (hasSimpleperfProfileabilityError(text)) {
    return 'Use a debuggable/profileable Android app or a device image that permits simpleperf for the target process, then retry perf cpu profile start.';
  }
  if (text.includes('not supported') || text.includes('failed to open perf event')) {
    return 'This device image does not expose the requested simpleperf event for the app process. Try a different emulator/system image or a profileable app.';
  }
  return buildAndroidNativePerfHint('simpleperf');
}

function hasSimpleperfProfileabilityError(text: string): boolean {
  return (
    text.includes('permission denied') ||
    text.includes('not profileable') ||
    text.includes('profileable')
  );
}

function hasPerfettoPermissionError(text: string): boolean {
  return text.includes('permission denied') || text.includes('not allowed');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
