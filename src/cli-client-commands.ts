import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CliFlags } from './utils/command-schema.ts';
import { formatScreenshotDiffText, formatSnapshotText, printJson } from './utils/output.ts';
import { AppError } from './utils/errors.ts';
import {
  serializeCloseResult,
  serializeDeployResult,
  serializeDevice,
  serializeEnsureSimulatorResult,
  serializeInstallFromSourceResult,
  serializeOpenResult,
  serializeSessionListEntry,
  serializeSnapshotResult,
} from './cli-serializers.ts';
import { compareScreenshots, type ScreenshotDiffResult } from './utils/screenshot-diff.ts';
import { resolveUserPath } from './utils/path-resolution.ts';
import { resolveRemoteOpenRuntime } from './core/remote-open.ts';
import { readCommandMessage } from './utils/success-text.ts';
import type { AgentDeviceClient, AgentDeviceDevice, AppDeployResult } from './client.ts';

export async function tryRunClientBackedCommand(params: {
  command: string;
  positionals: string[];
  flags: CliFlags;
  client: AgentDeviceClient;
}): Promise<boolean> {
  const handler = clientCommandHandlers[params.command];
  return handler ? await handler(params) : false;
}

type ClientCommandParams = {
  positionals: string[];
  flags: CliFlags;
  client: AgentDeviceClient;
};

type ClientCommandHandler = (params: ClientCommandParams) => Promise<boolean>;

const clientCommandHandlers: Partial<Record<string, ClientCommandHandler>> = {
  session: async ({ positionals, flags, client }) => {
    const sub = positionals[0] ?? 'list';
    if (sub !== 'list') {
      throw new AppError('INVALID_ARGS', 'session only supports list');
    }
    const sessions = await client.sessions.list();
    const data = { sessions: sessions.map(serializeSessionListEntry) };
    if (flags.json) printJson({ success: true, data });
    else process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return true;
  },
  devices: async ({ flags, client }) => {
    const devices = await client.devices.list(buildSelectionOptions(flags));
    const data = { devices: devices.map(serializeDevice) };
    if (flags.json) printJson({ success: true, data });
    else process.stdout.write(`${devices.map(formatDeviceLine).join('\n')}\n`);
    return true;
  },
  'ensure-simulator': async ({ flags, client }) => {
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
  },
  metro: async ({ positionals, flags, client }) => {
    const action = (positionals[0] ?? '').toLowerCase();
    if (action !== 'prepare') {
      throw new AppError('INVALID_ARGS', 'metro only supports prepare');
    }
    if (!flags.metroPublicBaseUrl) {
      throw new AppError('INVALID_ARGS', 'metro prepare requires --public-base-url <url>.');
    }

    const result = await client.metro.prepare({
      projectRoot: flags.metroProjectRoot,
      kind: flags.metroKind,
      port: flags.metroPreparePort,
      listenHost: flags.metroListenHost,
      statusHost: flags.metroStatusHost,
      publicBaseUrl: flags.metroPublicBaseUrl,
      proxyBaseUrl: flags.metroProxyBaseUrl,
      bearerToken: flags.metroBearerToken,
      startupTimeoutMs: flags.metroStartupTimeoutMs,
      probeTimeoutMs: flags.metroProbeTimeoutMs,
      reuseExisting: flags.metroNoReuseExisting ? false : undefined,
      installDependenciesIfNeeded: flags.metroNoInstallDeps ? false : undefined,
      runtimeFilePath: flags.metroRuntimeFile,
    });

    writeMetroPrepareResult(result, flags);
    return true;
  },
  install: async ({ positionals, flags, client }) => {
    const result = await runDeployCommand('install', positionals, flags, client);
    const data = serializeDeployResult(result);
    if (flags.json) printJson({ success: true, data });
    else writeHumanMessage(data);
    return true;
  },
  reinstall: async ({ positionals, flags, client }) => {
    const result = await runDeployCommand('reinstall', positionals, flags, client);
    const data = serializeDeployResult(result);
    if (flags.json) printJson({ success: true, data });
    else writeHumanMessage(data);
    return true;
  },
  'install-from-source': async ({ positionals, flags, client }) => {
    const result = await runInstallFromSourceCommand(positionals, flags, client);
    const data = serializeInstallFromSourceResult(result);
    if (flags.json) printJson({ success: true, data });
    else writeHumanMessage(data);
    return true;
  },
  open: async ({ positionals, flags, client }) => {
    if (!positionals[0]) {
      return false;
    }
    const runtime = await resolveRemoteOpenRuntime(flags, client);
    const result = await client.apps.open({
      app: positionals[0],
      url: positionals[1],
      surface: flags.surface,
      activity: flags.activity,
      relaunch: flags.relaunch,
      saveScript: flags.saveScript,
      noRecord: flags.noRecord,
      runtime,
      ...buildSelectionOptions(flags),
    });
    const data = serializeOpenResult(result);
    if (flags.json) printJson({ success: true, data });
    else {
      const successText = readCommandMessage(data);
      if (successText) process.stdout.write(`${successText}\n`);
    }
    return true;
  },
  close: async ({ positionals, flags, client }) => {
    const result = positionals[0]
      ? await client.apps.close({ app: positionals[0], shutdown: flags.shutdown })
      : await client.sessions.close({ shutdown: flags.shutdown });
    const data = serializeCloseResult(result);
    if (flags.json) {
      printJson({ success: true, data });
    } else {
      const successText = readCommandMessage(data);
      if (successText) process.stdout.write(`${successText}\n`);
    }
    return true;
  },
  snapshot: async ({ flags, client }) => {
    const result = await client.capture.snapshot({
      ...buildSelectionOptions(flags),
      interactiveOnly: flags.snapshotInteractiveOnly,
      compact: flags.snapshotCompact,
      depth: flags.snapshotDepth,
      scope: flags.snapshotScope,
      raw: flags.snapshotRaw,
    });
    const data = serializeSnapshotResult(result);
    if (flags.json) {
      printJson({ success: true, data });
    } else {
      process.stdout.write(
        formatSnapshotText(data, {
          raw: flags.snapshotRaw,
          flatten: flags.snapshotInteractiveOnly,
        }),
      );
    }
    return true;
  },
  screenshot: async ({ positionals, flags, client }) => {
    const result = await client.capture.screenshot({
      path: positionals[0] ?? flags.out,
      overlayRefs: flags.overlayRefs,
    });
    const data = {
      path: result.path,
      ...(result.overlayRefs ? { overlayRefs: result.overlayRefs } : {}),
    };
    if (flags.json) printJson({ success: true, data });
    else if (result.overlayRefs) {
      process.stdout.write(`Annotated ${result.overlayRefs.length} refs onto ${result.path}\n`);
    } else {
      process.stdout.write(`${result.path}\n`);
    }
    return true;
  },
  diff: async ({ positionals, flags, client }) => {
    if (positionals[0] !== 'screenshot') return false;

    const baselineRaw = flags.baseline;
    if (!baselineRaw || typeof baselineRaw !== 'string') {
      throw new AppError('INVALID_ARGS', 'diff screenshot requires --baseline <path>');
    }

    const baselinePath = resolveUserPath(baselineRaw);
    const outputPath = typeof flags.out === 'string' ? resolveUserPath(flags.out) : undefined;

    let thresholdNum = 0.1;
    if (flags.threshold != null && flags.threshold !== '') {
      thresholdNum = Number(flags.threshold);
      if (Number.isNaN(thresholdNum) || thresholdNum < 0 || thresholdNum > 1) {
        throw new AppError('INVALID_ARGS', '--threshold must be a number between 0 and 1');
      }
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-diff-current-'));
    const tmpScreenshotPath = path.join(tmpDir, `current-${Date.now()}.png`);
    const screenshotResult = await client.capture.screenshot({ path: tmpScreenshotPath });
    const currentPath = screenshotResult.path;

    let result: ScreenshotDiffResult;
    try {
      result = await compareScreenshots(baselinePath, currentPath, {
        threshold: thresholdNum,
        outputPath,
      });
    } finally {
      try {
        fs.unlinkSync(currentPath);
      } catch {}
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }

    if (flags.json) {
      printJson({ success: true, data: result });
    } else {
      process.stdout.write(formatScreenshotDiffText(result));
    }
    return true;
  },
};

function writeHumanMessage(data: Record<string, unknown>): void {
  const message = readCommandMessage(data);
  if (message) process.stdout.write(`${message}\n`);
}

async function runDeployCommand(
  command: 'install' | 'reinstall',
  positionals: string[],
  flags: CliFlags,
  client: AgentDeviceClient,
): Promise<AppDeployResult> {
  const app = positionals[0];
  const appPath = positionals[1];
  if (!app || !appPath) {
    throw new AppError(
      'INVALID_ARGS',
      `${command} requires: ${command} <app> <path-to-app-binary>`,
    );
  }
  const options = {
    app,
    appPath,
    ...buildSelectionOptions(flags),
  };
  return command === 'install'
    ? await client.apps.install(options)
    : await client.apps.reinstall(options);
}

async function runInstallFromSourceCommand(
  positionals: string[],
  flags: CliFlags,
  client: AgentDeviceClient,
) {
  const url = positionals[0]?.trim();
  if (!url) {
    throw new AppError('INVALID_ARGS', 'install-from-source requires: install-from-source <url>');
  }
  if (positionals.length > 1) {
    throw new AppError(
      'INVALID_ARGS',
      'install-from-source accepts exactly one positional argument: <url>',
    );
  }
  return await client.apps.installFromSource({
    ...buildSelectionOptions(flags),
    retainPaths: flags.retainPaths,
    retentionMs: flags.retentionMs,
    source: {
      kind: 'url',
      url,
      headers: parseInstallSourceHeaders(flags.header),
    },
  });
}

function parseInstallSourceHeaders(
  headerFlags: CliFlags['header'],
): Record<string, string> | undefined {
  if (!headerFlags || headerFlags.length === 0) return undefined;
  const headers: Record<string, string> = {};
  for (const rawHeader of headerFlags) {
    const separator = rawHeader.indexOf(':');
    if (separator <= 0) {
      throw new AppError(
        'INVALID_ARGS',
        `Invalid --header value "${rawHeader}". Expected "name:value".`,
      );
    }
    const name = rawHeader.slice(0, separator).trim();
    const value = rawHeader.slice(separator + 1).trim();
    if (!name) {
      throw new AppError(
        'INVALID_ARGS',
        `Invalid --header value "${rawHeader}". Header name cannot be empty.`,
      );
    }
    headers[name] = value;
  }
  return headers;
}

function writeMetroPrepareResult(result: unknown, flags: CliFlags): void {
  if (flags.json) {
    printJson({ success: true, data: result });
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

function buildSelectionOptions(flags: CliFlags): {
  platform?: CliFlags['platform'];
  target?: CliFlags['target'];
  device?: string;
  udid?: string;
  serial?: string;
  iosSimulatorDeviceSet?: string;
  androidDeviceAllowlist?: string;
} {
  return {
    platform: flags.platform,
    target: flags.target,
    device: flags.device,
    udid: flags.udid,
    serial: flags.serial,
    iosSimulatorDeviceSet: flags.iosSimulatorDeviceSet,
    androidDeviceAllowlist: flags.androidDeviceAllowlist,
  };
}

function formatDeviceLine(device: AgentDeviceDevice): string {
  const kind = device.kind ? ` ${device.kind}` : '';
  const target = device.target ? ` target=${device.target}` : '';
  const booted = typeof device.booted === 'boolean' ? ` booted=${device.booted}` : '';
  return `${device.name} (${device.platform}${kind}${target})${booted}`;
}
