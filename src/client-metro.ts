import fs from 'node:fs';
import path from 'node:path';
import { sleep } from './utils/timeouts.ts';
import { ensureMetroCompanion } from './client-metro-companion.ts';
import type { CompanionTunnelScope as MetroBridgeScope } from './client-companion-tunnel-contract.ts';
import type {
  MetroBridgeDescriptor,
  MetroBridgeResult,
  MetroBridgeRuntimePayload,
  MetroRuntimeHints,
} from './metro-types.ts';
import { AppError } from './utils/errors.ts';
import { runCmdSync, runCmdDetached } from './utils/exec.ts';
import { resolveUserPath } from './utils/path-resolution.ts';
import { waitForProcessExit } from './utils/process-identity.ts';
import { buildBundleUrl, normalizeBaseUrl } from './utils/url.ts';
import {
  resolveRuntimeTransportHints,
  type ResolvedRuntimeTransport,
} from './utils/runtime-transport.ts';

const DEFAULT_METRO_HOST = 'localhost';
const DEFAULT_METRO_PORT = 8081;
const METRO_TERM_TIMEOUT_MS = 1_000;
const METRO_KILL_TIMEOUT_MS = 1_000;

export type MetroPrepareKind = 'auto' | 'react-native' | 'expo';
type ResolvedMetroKind = Exclude<MetroPrepareKind, 'auto'>;
type EnvSource = NodeJS.ProcessEnv | Record<string, string | undefined>;

export type { MetroBridgeScope };

type PackageJsonShape = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type PackageManagerConfig = {
  command: string;
  installArgs: string[];
};

type MetroProcessResult = {
  pid: number;
};

export type PrepareMetroRuntimeOptions = {
  projectRoot?: string;
  kind?: MetroPrepareKind;
  metroPort?: number | string;
  listenHost?: string;
  statusHost?: string;
  publicBaseUrl?: string;
  proxyBaseUrl?: string;
  proxyBearerToken?: string;
  bridgeScope?: MetroBridgeScope;
  launchUrl?: string;
  companionProfileKey?: string;
  companionConsumerKey?: string;
  startupTimeoutMs?: number | string;
  probeTimeoutMs?: number | string;
  reuseExisting?: boolean;
  installDependenciesIfNeeded?: boolean;
  runtimeFilePath?: string;
  logPath?: string;
  env?: EnvSource;
};

export type PrepareMetroRuntimeResult = {
  projectRoot: string;
  kind: ResolvedMetroKind;
  dependenciesInstalled: boolean;
  packageManager: string | null;
  started: boolean;
  reused: boolean;
  pid: number;
  logPath: string;
  statusUrl: string;
  runtimeFilePath: string | null;
  iosRuntime: MetroRuntimeHints;
  androidRuntime: MetroRuntimeHints;
  bridge: MetroBridgeResult | null;
};

export type ReloadMetroOptions = {
  metroHost?: string;
  metroPort?: number | string;
  bundleUrl?: string;
  runtime?: MetroRuntimeHints;
  timeoutMs?: number | string;
};

export type ReloadMetroResult = {
  reloaded: true;
  reloadUrl: string;
  status: number;
  body: string;
};

type ProxyBridgeRequestOptions = {
  baseUrl: string;
  bearerToken: string;
  scope: MetroBridgeScope;
  runtime?: MetroBridgeRuntimePayload;
  timeoutMs: number;
};

type MetroBridgeRequestError = Error & {
  retryable?: boolean;
};

function normalizeOptionalBaseUrl(input: unknown): string {
  return typeof input === 'string' && input.trim() ? normalizeBaseUrl(input.trim()) : '';
}

function normalizeOptionalString(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim() ? input.trim() : undefined;
}

function resolvePath(inputPath: string, env: EnvSource, cwd: string): string {
  return resolveUserPath(inputPath, { env, cwd });
}

function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function directoryExists(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function readPackageJson(projectRoot: string): PackageJsonShape {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (!fileExists(packageJsonPath)) {
    throw new AppError('INVALID_ARGS', `package.json not found at ${packageJsonPath}`);
  }

  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageJsonShape;
}

function detectPackageManager(projectRoot: string): PackageManagerConfig {
  if (fileExists(path.join(projectRoot, 'pnpm-lock.yaml'))) {
    return { command: 'pnpm', installArgs: ['install'] };
  }
  if (fileExists(path.join(projectRoot, 'yarn.lock'))) {
    return { command: 'yarn', installArgs: ['install'] };
  }
  return { command: 'npm', installArgs: ['install'] };
}

function detectMetroKind(projectRoot: string, requestedKind: MetroPrepareKind): ResolvedMetroKind {
  if (requestedKind !== 'auto') {
    return requestedKind;
  }

  const packageJson = readPackageJson(projectRoot);
  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  };

  return typeof dependencies.expo === 'string' ? 'expo' : 'react-native';
}

function parseTimeout(
  value: number | string | undefined,
  fallback: number,
  minimum: number,
): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.max(parsed, minimum);
}

function parsePort(value: number | string | undefined, fallback: number): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new AppError('INVALID_ARGS', `Invalid Metro port: ${String(value)}. Use 1-65535.`);
  }
  return parsed;
}

export function buildMetroRuntimeHints(
  baseUrl: string,
  platform: 'ios' | 'android',
): MetroRuntimeHints {
  return {
    platform,
    bundleUrl: buildBundleUrl(baseUrl, platform),
  };
}

function normalizeProxyRuntimeHints(
  value: MetroBridgeRuntimePayload | undefined,
  platform: 'ios' | 'android',
): MetroRuntimeHints {
  return {
    platform,
    metroHost: normalizeOptionalString(value?.metro_host),
    metroPort: value?.metro_port,
    bundleUrl: normalizeOptionalString(value?.metro_bundle_url),
    launchUrl: normalizeOptionalString(value?.launch_url),
  };
}

function installDependenciesIfNeeded(
  projectRoot: string,
  env: EnvSource,
): { installed: boolean; packageManager?: string } {
  if (directoryExists(path.join(projectRoot, 'node_modules'))) {
    return { installed: false };
  }

  const packageManager = detectPackageManager(projectRoot);
  runCmdSync(packageManager.command, packageManager.installArgs, {
    cwd: projectRoot,
    env: env as NodeJS.ProcessEnv,
  });
  return { installed: true, packageManager: packageManager.command };
}

async function wait(ms: number): Promise<void> {
  await sleep(ms);
}

async function fetchText(
  url: string,
  timeoutMs: number,
  extraHeaders: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const response = await fetch(url, {
      headers: extraHeaders,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`Timed out fetching ${url} after ${timeoutMs}ms`);
    }
    throw error;
  }
}

async function isMetroReady(statusUrl: string, timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetchText(statusUrl, timeoutMs);
    return response.ok && response.body.includes('packager-status:running');
  } catch {
    return false;
  }
}

function buildReloadUrl(transport: ResolvedRuntimeTransport, pathName: string): string {
  const url = new URL(`${transport.scheme}://localhost`);
  url.hostname = transport.host;
  url.port = String(transport.port);
  url.pathname = pathName;
  return url.toString();
}

function resolveMetroReloadPath(bundleUrl: string | undefined): string {
  const value = normalizeOptionalString(bundleUrl);
  if (!value) return '/reload';
  const url = new URL(value);
  const bundlePath = url.pathname.replace(/\/+$/, '');
  if (!bundlePath.endsWith('/index.bundle')) return '/reload';
  return `${bundlePath.slice(0, -'/index.bundle'.length)}/reload`;
}

function resolveMetroReloadUrl(input: ReloadMetroOptions): string {
  const bundleUrl = normalizeOptionalString(input.bundleUrl) ?? input.runtime?.bundleUrl;
  const hasExplicitBundleUrl = Boolean(normalizeOptionalString(input.bundleUrl));
  const hasBundleUrl = Boolean(normalizeOptionalString(bundleUrl));
  const metroHost =
    normalizeOptionalString(input.metroHost) ??
    (hasExplicitBundleUrl ? undefined : normalizeOptionalString(input.runtime?.metroHost)) ??
    (hasBundleUrl ? undefined : DEFAULT_METRO_HOST);
  const metroPort =
    input.metroPort !== undefined
      ? parsePort(input.metroPort, DEFAULT_METRO_PORT)
      : hasExplicitBundleUrl
        ? undefined
        : (input.runtime?.metroPort ?? (hasBundleUrl ? undefined : DEFAULT_METRO_PORT));
  const transport = resolveRuntimeTransportHints({
    metroHost,
    metroPort,
    bundleUrl,
  });
  if (!transport) {
    throw new AppError('INVALID_ARGS', 'Unable to resolve Metro host and port for reload.');
  }
  return buildReloadUrl(transport, resolveMetroReloadPath(bundleUrl));
}

function buildMetroCommand(
  kind: ResolvedMetroKind,
  port: number,
  listenHost: string,
): PackageManagerConfig {
  if (kind === 'expo') {
    return {
      command: 'npx',
      installArgs: ['expo', 'start', '--host', 'lan', '--port', String(port)],
    };
  }

  return {
    command: 'npx',
    installArgs: ['react-native', 'start', '--host', listenHost, '--port', String(port)],
  };
}

function startMetroProcess(
  projectRoot: string,
  kind: ResolvedMetroKind,
  port: number,
  listenHost: string,
  logPath: string,
  env: EnvSource,
): MetroProcessResult {
  const metro = buildMetroCommand(kind, port, listenHost);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, 'a');
  let pid = 0;
  try {
    pid = runCmdDetached(metro.command, metro.installArgs, {
      cwd: projectRoot,
      env: env as NodeJS.ProcessEnv,
      stdio: ['ignore', logFd, logFd],
    });
  } finally {
    fs.closeSync(logFd);
  }

  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error('Failed to start Metro. Expected a detached child PID.');
  }

  return {
    pid,
  };
}

async function stopSpawnedMetroProcess(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH' || code === 'EPERM') return;
    throw error;
  }
  if (await waitForProcessExit(pid, METRO_TERM_TIMEOUT_MS)) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH' || code === 'EPERM') return;
    throw error;
  }
  await waitForProcessExit(pid, METRO_KILL_TIMEOUT_MS);
}

function createProxyHeaders(baseUrl: string, bearerToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${bearerToken}`,
    'Content-Type': 'application/json',
    ...(baseUrl.includes('ngrok') ? { 'ngrok-skip-browser-warning': '1' } : {}),
  };
}

function createMetroBridgeRequestError(
  message: string,
  retryable: boolean,
): MetroBridgeRequestError {
  const error = new Error(message) as MetroBridgeRequestError;
  error.retryable = retryable;
  return error;
}

function isRetryableBridgeHttpFailure(statusCode: number, responsePayload: unknown): boolean {
  if (statusCode >= 500 || statusCode === 408 || statusCode === 425 || statusCode === 429) {
    return true;
  }
  const responseText = JSON.stringify(responsePayload);
  if (responseText.includes('Metro companion is not connected')) {
    return true;
  }
  return false;
}

function isRetryableBridgeError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'retryable' in error &&
    (error as MetroBridgeRequestError).retryable === true,
  );
}

async function configureMetroBridge(input: ProxyBridgeRequestOptions): Promise<MetroBridgeResult> {
  let response: Response;

  try {
    response = await fetch(`${input.baseUrl}/api/metro/bridge`, {
      method: 'POST',
      headers: createProxyHeaders(input.baseUrl, input.bearerToken),
      body: JSON.stringify({
        ...input.scope,
        ...(input.runtime ? { ios_runtime: input.runtime } : {}),
        timeout_ms: input.timeoutMs,
      }),
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw createMetroBridgeRequestError(
        `/api/metro/bridge timed out after ${input.timeoutMs}ms calling ${input.baseUrl}/api/metro/bridge`,
        true,
      );
    }
    throw createMetroBridgeRequestError(
      error instanceof Error ? error.message : String(error),
      true,
    );
  }

  const responseText = await response.text();
  const responsePayload = parseMetroBridgeResponsePayload(
    responseText,
    response.status,
    input.baseUrl,
  );

  if (!response.ok) {
    throw createMetroBridgeRequestError(
      `/api/metro/bridge failed (${response.status}): ${JSON.stringify(responsePayload)}`,
      isRetryableBridgeHttpFailure(response.status, responsePayload),
    );
  }

  return normalizeMetroBridgeResponsePayload(responsePayload);
}

function parseMetroBridgeResponsePayload(
  responseText: string,
  statusCode: number,
  baseUrl: string,
): Record<string, unknown> {
  if (!responseText) return {};
  try {
    const parsed = JSON.parse(responseText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    const snippet = responseText.slice(0, 200);
    const detail = error instanceof Error ? error.message : String(error);
    throw createMetroBridgeRequestError(
      `/api/metro/bridge returned invalid JSON (${statusCode}) from ${baseUrl}: ${detail}. body=${JSON.stringify(snippet)}`,
      isRetryableBridgeHttpFailure(statusCode, responseText),
    );
  }
}

function normalizeBridgeResponse(response: MetroBridgeDescriptor): MetroBridgeResult {
  return {
    enabled: response.enabled,
    baseUrl: response.base_url,
    statusUrl: response.status_url ?? '',
    bundleUrl: response.bundle_url ?? '',
    iosRuntime: normalizeProxyRuntimeHints(response.ios_runtime, 'ios'),
    androidRuntime: normalizeProxyRuntimeHints(response.android_runtime, 'android'),
    upstream: {
      bundleUrl: response.upstream.bundle_url ?? '',
      host: response.upstream.host ?? '',
      port: response.upstream.port ?? 0,
      statusUrl: response.upstream.status_url ?? '',
    },
    probe: {
      reachable: response.probe.reachable,
      statusCode: response.probe.status_code,
      latencyMs: response.probe.latency_ms,
      detail: response.probe.detail,
    },
  };
}

function normalizeMetroBridgeResponsePayload(
  responsePayload: Record<string, unknown>,
): MetroBridgeResult {
  const descriptor = responsePayload.data ?? responsePayload;
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw createMetroBridgeRequestError(
      '/api/metro/bridge returned malformed descriptor: Expected a JSON object.',
      false,
    );
  }
  try {
    return normalizeBridgeResponse(descriptor as MetroBridgeDescriptor);
  } catch (error) {
    throw createMetroBridgeRequestError(
      `/api/metro/bridge returned malformed descriptor: ${error instanceof Error ? error.message : String(error)}`,
      false,
    );
  }
}

function describeBridgeFailure(
  baseUrl: string,
  bridgeError: string | null,
  bridge: MetroBridgeResult | null,
  initialBridgeError?: string | null,
  companionLogPath?: string,
): string {
  const parts = [
    `Metro bridge is required for this run but could not be configured via ${baseUrl}/api/metro/bridge.`,
  ];

  if (bridgeError) {
    parts.push(`bridgeError=${bridgeError}`);
  }
  if (bridge?.probe.reachable === false) {
    parts.push(
      `bridgeProbe=${bridge.probe.detail || `unreachable (status ${bridge.probe.statusCode || 0})`}`,
    );
  }
  if (initialBridgeError && initialBridgeError !== bridgeError) {
    parts.push(`initialBridgeError=${initialBridgeError}`);
  }
  if (companionLogPath) {
    parts.push(`metroCompanionLog=${companionLogPath}`);
  }

  return parts.join(' ');
}

function requireBridgeRuntimeDescriptor(baseUrl: string, bridge: MetroBridgeResult | null): void {
  if (!bridge?.iosRuntime.bundleUrl) {
    throw new Error(
      describeBridgeFailure(
        baseUrl,
        'bridge descriptor is missing ios_runtime.metro_bundle_url',
        bridge,
      ),
    );
  }
}

function resolveProxySettings(
  proxyBaseUrl: string,
  proxyBearerToken: string,
): {
  proxyEnabled: boolean;
  proxyBaseUrl: string;
  proxyBearerToken: string;
} {
  if (proxyBaseUrl && !proxyBearerToken) {
    throw new AppError(
      'INVALID_ARGS',
      'metro prepare requires proxy auth when --proxy-base-url is provided. Pass --bearer-token or set AGENT_DEVICE_PROXY_TOKEN.',
    );
  }
  if (!proxyBaseUrl && proxyBearerToken) {
    throw new AppError(
      'INVALID_ARGS',
      'metro prepare requires --proxy-base-url when proxy auth is provided.',
    );
  }
  return {
    proxyEnabled: Boolean(proxyBaseUrl && proxyBearerToken),
    proxyBaseUrl,
    proxyBearerToken,
  };
}

function requireBridgeScope(scope: MetroBridgeScope | undefined): MetroBridgeScope {
  if (!scope?.tenantId || !scope.runId || !scope.leaseId) {
    throw new AppError(
      'INVALID_ARGS',
      'metro prepare with proxy requires tenantId, runId, and leaseId bridge scope.',
    );
  }
  return scope;
}

async function waitForMetroReady(
  statusUrl: string,
  startupTimeoutMs: number,
  probeTimeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    const requestTimeoutMs = Math.min(probeTimeoutMs, Math.max(remainingMs, 1));
    if (await isMetroReady(statusUrl, requestTimeoutMs)) {
      return true;
    }
    const sleepMs = Math.min(500, Math.max(deadline - Date.now(), 0));
    if (sleepMs > 0) {
      await wait(sleepMs);
    }
  }
  return false;
}

async function configureMetroBridgeUntilReady(options: {
  baseUrl: string;
  bearerToken: string;
  scope: MetroBridgeScope;
  runtime?: MetroBridgeRuntimePayload;
  probeTimeoutMs: number;
  startupTimeoutMs: number;
  initialBridgeError?: string | null;
  companionLogPath?: string;
}): Promise<MetroBridgeResult> {
  const deadline = Date.now() + options.startupTimeoutMs;
  let lastBridge: MetroBridgeResult | null = null;
  let lastBridgeError: string | null = null;

  while (Date.now() < deadline) {
    try {
      const bridge = await configureMetroBridge({
        baseUrl: options.baseUrl,
        bearerToken: options.bearerToken,
        scope: options.scope,
        runtime: options.runtime,
        timeoutMs: options.probeTimeoutMs,
      });
      if (bridge.probe.reachable !== false) {
        return bridge;
      }
      lastBridge = bridge;
      lastBridgeError = null;
    } catch (error) {
      lastBridgeError = error instanceof Error ? error.message : String(error);
      if (!isRetryableBridgeError(error)) {
        throw new Error(
          describeBridgeFailure(
            options.baseUrl,
            lastBridgeError,
            lastBridge,
            options.initialBridgeError,
            options.companionLogPath,
          ),
        );
      }
    }

    const sleepMs = Math.min(1_000, Math.max(deadline - Date.now(), 0));
    if (sleepMs > 0) {
      await wait(sleepMs);
    }
  }

  throw new Error(
    describeBridgeFailure(
      options.baseUrl,
      lastBridgeError,
      lastBridge,
      options.initialBridgeError,
      options.companionLogPath,
    ),
  );
}

export async function prepareMetroRuntime(
  input: PrepareMetroRuntimeOptions = {},
): Promise<PrepareMetroRuntimeResult> {
  const env = input.env ?? process.env;
  const cwd = process.cwd();
  const projectRoot = resolvePath(input.projectRoot ?? cwd, env, cwd);
  const kind = detectMetroKind(projectRoot, input.kind ?? 'auto');
  const metroPort = parsePort(input.metroPort ?? 8081, 8081);
  const listenHost = normalizeOptionalString(input.listenHost) ?? '0.0.0.0';
  const statusHost = normalizeOptionalString(input.statusHost) ?? '127.0.0.1';
  const publicBaseUrl = normalizeOptionalBaseUrl(input.publicBaseUrl);
  const startupTimeoutMs = parseTimeout(input.startupTimeoutMs, 180_000, 30_000);
  const probeTimeoutMs = parseTimeout(input.probeTimeoutMs, 10_000, 1_000);
  const reuseExisting = input.reuseExisting ?? true;
  const installProjectDeps = input.installDependenciesIfNeeded ?? true;
  const runtimeFilePath = input.runtimeFilePath
    ? resolvePath(input.runtimeFilePath, env, cwd)
    : null;
  const logPath = resolvePath(
    input.logPath ?? path.join(projectRoot, '.agent-device', 'metro.log'),
    env,
    cwd,
  );

  if (!publicBaseUrl) {
    const hasProxyBaseUrl = Boolean(normalizeOptionalBaseUrl(input.proxyBaseUrl));
    if (!hasProxyBaseUrl) {
      throw new AppError('INVALID_ARGS', 'metro prepare requires --public-base-url <url>.');
    }
  }

  const { proxyEnabled, proxyBaseUrl, proxyBearerToken } = resolveProxySettings(
    normalizeOptionalBaseUrl(input.proxyBaseUrl),
    normalizeOptionalString(input.proxyBearerToken) ?? '',
  );
  const bridgeScope = proxyEnabled ? requireBridgeScope(input.bridgeScope) : null;

  const dependencyInstall = installProjectDeps
    ? installDependenciesIfNeeded(projectRoot, env)
    : { installed: false as const };
  const statusUrl = `http://${statusHost}:${metroPort}/status`;

  let started = false;
  let reused = false;
  let pid = 0;
  if (reuseExisting && (await isMetroReady(statusUrl, probeTimeoutMs))) {
    reused = true;
  } else {
    const startedProcess = startMetroProcess(
      projectRoot,
      kind,
      metroPort,
      listenHost,
      logPath,
      env,
    );
    started = true;
    pid = startedProcess.pid;

    if (!(await waitForMetroReady(statusUrl, startupTimeoutMs, probeTimeoutMs))) {
      await stopSpawnedMetroProcess(pid).catch(() => {});
      throw new Error(
        `Metro did not become ready at ${statusUrl} within ${startupTimeoutMs}ms. Check ${logPath}.`,
      );
    }
  }

  const publicIosRuntime = publicBaseUrl
    ? buildMetroRuntimeHints(publicBaseUrl, 'ios')
    : { platform: 'ios' as const };
  const publicAndroidRuntime = publicBaseUrl
    ? buildMetroRuntimeHints(publicBaseUrl, 'android')
    : { platform: 'android' as const };

  let bridge: MetroBridgeResult | null = null;
  let initialBridgeError: string | null = null;

  if (bridgeScope) {
    try {
      bridge = await configureMetroBridge({
        baseUrl: proxyBaseUrl,
        bearerToken: proxyBearerToken,
        scope: bridgeScope,
        timeoutMs: probeTimeoutMs,
      });
    } catch (error) {
      if (!isRetryableBridgeError(error)) {
        throw error;
      }
      initialBridgeError = error instanceof Error ? error.message : String(error);
    }
  }

  if (bridgeScope && (!bridge || bridge.probe.reachable === false)) {
    let companionLogPath: string | undefined;
    try {
      const companion = await ensureMetroCompanion({
        projectRoot,
        serverBaseUrl: proxyBaseUrl,
        bearerToken: proxyBearerToken,
        bridgeScope,
        localBaseUrl: `http://${statusHost}:${metroPort}`,
        launchUrl: normalizeOptionalString(input.launchUrl),
        profileKey: normalizeOptionalString(input.companionProfileKey),
        consumerKey: normalizeOptionalString(input.companionConsumerKey),
        env: env as NodeJS.ProcessEnv,
      });
      companionLogPath = companion.logPath;
    } catch (error) {
      throw new Error(
        describeBridgeFailure(
          proxyBaseUrl,
          error instanceof Error ? error.message : String(error),
          bridge,
          initialBridgeError,
        ),
      );
    }
    try {
      bridge = await configureMetroBridgeUntilReady({
        baseUrl: proxyBaseUrl,
        bearerToken: proxyBearerToken,
        scope: bridgeScope,
        probeTimeoutMs,
        startupTimeoutMs,
        initialBridgeError,
        companionLogPath,
      });
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  if (bridgeScope) {
    requireBridgeRuntimeDescriptor(proxyBaseUrl, bridge);
  }

  const iosRuntime = bridge?.iosRuntime ?? publicIosRuntime;
  const androidRuntime = bridge?.androidRuntime ?? publicAndroidRuntime;
  const result: PrepareMetroRuntimeResult = {
    projectRoot,
    kind,
    dependenciesInstalled: dependencyInstall.installed,
    packageManager: dependencyInstall.packageManager ?? null,
    started,
    reused,
    pid,
    logPath,
    statusUrl,
    runtimeFilePath,
    iosRuntime,
    androidRuntime,
    bridge,
  };

  if (runtimeFilePath) {
    fs.mkdirSync(path.dirname(runtimeFilePath), { recursive: true });
    fs.writeFileSync(runtimeFilePath, JSON.stringify(result, null, 2));
  }

  return result;
}

export async function reloadMetro(input: ReloadMetroOptions = {}): Promise<ReloadMetroResult> {
  const timeoutMs = parseTimeout(input.timeoutMs, 10_000, 1_000);
  const reloadUrl = resolveMetroReloadUrl(input);
  const response = await fetchText(reloadUrl, timeoutMs);
  if (!response.ok) {
    throw new AppError('COMMAND_FAILED', `Metro reload failed (${response.status}).`, {
      reloadUrl,
      status: response.status,
      body: response.body,
      hint: 'Verify Metro is running and the target React Native app is connected to this Metro instance.',
    });
  }
  return {
    reloaded: true,
    reloadUrl,
    status: response.status,
    body: response.body,
  };
}
