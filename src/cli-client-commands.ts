import type { CliFlags } from './utils/command-schema.ts';
import { formatSnapshotText, printJson } from './utils/output.ts';
import { AppError } from './utils/errors.ts';
import {
  serializeCloseResult,
  serializeDeployResult,
  serializeDevice,
  serializeEnsureSimulatorResult,
  serializeOpenResult,
  serializeRuntimeResult,
  serializeSessionListEntry,
  serializeSnapshotResult,
} from './client-shared.ts';
import type {
  AgentDeviceClient,
  AgentDeviceDevice,
  AppDeployResult,
  RuntimeResult,
} from './client.ts';

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
  runtime: async ({ positionals, flags, client }) => {
    const action = (positionals[0] ?? 'show').toLowerCase();
    if (action === 'set') {
      writeRuntimeResult(await client.runtime.set({
        platform: flags.platform,
        metroHost: flags.metroHost,
        metroPort: flags.metroPort,
        bundleUrl: flags.bundleUrl,
        launchUrl: flags.launchUrl,
      }), flags);
      return true;
    }
    if (action === 'show') {
      writeRuntimeResult(await client.runtime.show(), flags);
      return true;
    }
    return false;
  },
  install: async ({ positionals, flags, client }) => {
    const result = await runDeployCommand('install', positionals, flags, client);
    if (flags.json) printJson({ success: true, data: serializeDeployResult(result) });
    return true;
  },
  reinstall: async ({ positionals, flags, client }) => {
    const result = await runDeployCommand('reinstall', positionals, flags, client);
    if (flags.json) printJson({ success: true, data: serializeDeployResult(result) });
    return true;
  },
  open: async ({ positionals, flags, client }) => {
    if (!positionals[0]) {
      return false;
    }
    const result = await client.apps.open({
      app: positionals[0],
      url: positionals[1],
      activity: flags.activity,
      relaunch: flags.relaunch,
      saveScript: flags.saveScript,
      noRecord: flags.noRecord,
      ...buildSelectionOptions(flags),
    });
    if (flags.json) printJson({ success: true, data: serializeOpenResult(result) });
    return true;
  },
  close: async ({ positionals, flags, client }) => {
    const result = positionals[0]
      ? await client.apps.close({ app: positionals[0], shutdown: flags.shutdown })
      : await client.sessions.close({ shutdown: flags.shutdown });
    if (flags.json) {
      printJson({ success: true, data: serializeCloseResult(result) });
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
    const result = await client.capture.screenshot({ path: positionals[0] ?? flags.out });
    const data = { path: result.path };
    if (flags.json) printJson({ success: true, data });
    else process.stdout.write(`${result.path}\n`);
    return true;
  },
};

async function runDeployCommand(
  command: 'install' | 'reinstall',
  positionals: string[],
  flags: CliFlags,
  client: AgentDeviceClient,
): Promise<AppDeployResult> {
  const app = positionals[0];
  const appPath = positionals[1];
  if (!app || !appPath) {
    throw new AppError('INVALID_ARGS', `${command} requires: ${command} <app> <path-to-app-binary>`);
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

function writeRuntimeResult(result: RuntimeResult, flags: CliFlags): void {
  const data = serializeRuntimeResult(result);
  if (flags.json) {
    printJson({ success: true, data });
  } else if (!result.configured) {
    process.stdout.write('No runtime hints configured\n');
  } else {
    process.stdout.write(`${JSON.stringify(result.runtime ?? {}, null, 2)}\n`);
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
