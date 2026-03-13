import type { CliFlags } from './utils/command-schema.ts';
import { formatSnapshotText, printJson } from './utils/output.ts';
import { AppError } from './utils/errors.ts';
import type {
  AgentDeviceClient,
  AgentDeviceDevice,
  AgentDeviceSession,
  AppDeployResult,
  AppOpenResult,
  CaptureSnapshotResult,
  EnsureSimulatorResult,
  RuntimeResult,
  SessionCloseResult,
} from './client.ts';

export async function tryRunClientBackedCommand(params: {
  command: string;
  positionals: string[];
  flags: CliFlags;
  client: AgentDeviceClient;
}): Promise<boolean> {
  const { command, positionals, flags, client } = params;

  if (command === 'session') {
    const sub = positionals[0] ?? 'list';
    if (sub !== 'list') {
      throw new AppError('INVALID_ARGS', 'session only supports list');
    }
    const sessions = await client.sessions.list();
    const data = { sessions: sessions.map(serializeSessionListEntry) };
    if (flags.json) printJson({ success: true, data });
    else process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return true;
  }

  if (command === 'devices') {
    const devices = await client.devices.list(buildSelectionOptions(flags));
    const data = { devices: devices.map(serializeDevice) };
    if (flags.json) printJson({ success: true, data });
    else process.stdout.write(`${devices.map(formatDeviceLine).join('\n')}\n`);
    return true;
  }

  if (command === 'ensure-simulator') {
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
  }

  if (command === 'runtime') {
    const action = (positionals[0] ?? 'show').toLowerCase();
    if (action === 'set') {
      const result = await client.runtime.set({
        platform: flags.platform,
        metroHost: flags.metroHost,
        metroPort: flags.metroPort,
        bundleUrl: flags.bundleUrl,
        launchUrl: flags.launchUrl,
      });
      writeRuntimeResult(result, flags);
      return true;
    }
    if (action === 'show') {
      const result = await client.runtime.show();
      writeRuntimeResult(result, flags);
      return true;
    }
    return false;
  }

  if (command === 'install' || command === 'reinstall') {
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
    const result = command === 'install'
      ? await client.apps.install(options)
      : await client.apps.reinstall(options);
    if (flags.json) printJson({ success: true, data: serializeDeployResult(result) });
    return true;
  }

  if (command === 'open' && positionals[0]) {
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
  }

  if (command === 'close') {
    const result = positionals[0]
      ? await client.apps.close({ app: positionals[0], shutdown: flags.shutdown })
      : await client.sessions.close({ shutdown: flags.shutdown });
    if (flags.json) {
      printJson({
        success: true,
        data: serializeCloseResult(result),
      });
    }
    return true;
  }

  if (command === 'snapshot') {
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
  }

  if (command === 'screenshot') {
    const result = await client.capture.screenshot({ path: positionals[0] ?? flags.out });
    const data = { path: result.path };
    if (flags.json) printJson({ success: true, data });
    else process.stdout.write(`${result.path}\n`);
    return true;
  }

  return false;
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

function serializeSessionListEntry(session: AgentDeviceSession): Record<string, unknown> {
  return {
    name: session.name,
    platform: session.device.platform,
    target: session.device.target,
    device: session.device.name,
    id: session.device.id,
    createdAt: session.createdAt,
    ...(session.device.platform === 'ios' && {
      device_udid: session.device.ios?.udid ?? session.device.id,
      ios_simulator_device_set: session.device.ios?.simulatorSetPath ?? null,
    }),
  };
}

function serializeDevice(device: AgentDeviceDevice): Record<string, unknown> {
  return {
    platform: device.platform,
    id: device.id,
    name: device.name,
    kind: device.kind,
    target: device.target,
    ...(typeof device.booted === 'boolean' ? { booted: device.booted } : {}),
  };
}

function formatDeviceLine(device: AgentDeviceDevice): string {
  const kind = device.kind ? ` ${device.kind}` : '';
  const target = device.target ? ` target=${device.target}` : '';
  const booted = typeof device.booted === 'boolean' ? ` booted=${device.booted}` : '';
  return `${device.name} (${device.platform}${kind}${target})${booted}`;
}

function serializeEnsureSimulatorResult(result: EnsureSimulatorResult): Record<string, unknown> {
  return {
    udid: result.udid,
    device: result.device,
    runtime: result.runtime,
    ios_simulator_device_set: result.iosSimulatorDeviceSet ?? null,
    created: result.created,
    booted: result.booted,
  };
}

function serializeRuntimeResult(result: RuntimeResult): Record<string, unknown> {
  return {
    session: result.session,
    configured: result.configured,
    ...(result.cleared ? { cleared: true } : {}),
    ...(result.runtime ? { runtime: result.runtime } : {}),
  };
}

function serializeDeployResult(result: AppDeployResult): Record<string, unknown> {
  return {
    app: result.app,
    appPath: result.appPath,
    platform: result.platform,
    ...(result.appId ? { appId: result.appId } : {}),
    ...(result.bundleId ? { bundleId: result.bundleId } : {}),
    ...(result.package ? { package: result.package } : {}),
  };
}

function serializeOpenResult(result: AppOpenResult): Record<string, unknown> {
  return {
    session: result.session,
    ...(result.appName ? { appName: result.appName } : {}),
    ...(result.appBundleId ? { appBundleId: result.appBundleId } : {}),
    ...(result.startup ? { startup: result.startup } : {}),
    ...(result.runtime ? { runtime: result.runtime } : {}),
    ...(result.device
      ? {
        platform: result.device.platform,
        target: result.device.target,
        device: result.device.name,
        id: result.device.id,
      }
      : {}),
    ...(result.device?.platform === 'ios'
      ? {
        device_udid: result.device.ios?.udid ?? result.device.id,
        ios_simulator_device_set: result.device.ios?.simulatorSetPath ?? null,
      }
      : {}),
    ...(result.device?.platform === 'android'
      ? {
        serial: result.device.android?.serial ?? result.device.id,
      }
      : {}),
  };
}

function serializeCloseResult(result: SessionCloseResult): Record<string, unknown> {
  return {
    session: result.session,
    ...(result.shutdown ? { shutdown: result.shutdown } : {}),
  };
}

function serializeSnapshotResult(result: CaptureSnapshotResult): Record<string, unknown> {
  return {
    nodes: result.nodes,
    truncated: result.truncated,
    ...(result.appName ? { appName: result.appName } : {}),
    ...(result.appBundleId ? { appBundleId: result.appBundleId } : {}),
  };
}
