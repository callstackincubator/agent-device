# Typed Client

Use `createAgentDeviceClient()` when you want to drive the daemon from application code instead of shelling out to the CLI.

For remote Metro-backed flows, import the reusable Node APIs instead of spawning the `agent-device` binary. The CLI uses the same helpers internally.

Public subpath API exposed for Node consumers:

- `agent-device/metro`
  - `prepareRemoteMetro(options)`
  - `ensureMetroTunnel(options)`
  - `stopMetroTunnel(options)`
  - `buildIosRuntimeHints(baseUrl)`
  - `buildAndroidRuntimeHints(baseUrl)`
  - types: `PrepareRemoteMetroOptions`, `PrepareRemoteMetroResult`, `EnsureMetroTunnelOptions`, `EnsureMetroTunnelResult`, `StopMetroTunnelOptions`, `MetroRuntimeHints`, `MetroBridgeResult`
- `agent-device/remote-config`
  - `resolveRemoteConfigPath(options)`
  - `resolveRemoteConfigProfile(options)`
  - types: `RemoteConfigProfile`, `RemoteConfigProfileOptions`, `ResolvedRemoteConfigProfile`
- `agent-device/contracts`
  - types: `SessionRuntimeHints`, `DaemonInstallSource`, `DaemonLockPolicy`, `DaemonRequestMeta`, `DaemonRequest`, `DaemonArtifact`, `DaemonResponseData`, `DaemonError`, `DaemonResponse`

## Basic usage

```ts
import { createAgentDeviceClient } from 'agent-device';

const client = createAgentDeviceClient({
  session: 'qa-ios',
  lockPolicy: 'reject',
  lockPlatform: 'ios',
});

const devices = await client.devices.list({ platform: 'ios' });
const apps = await client.apps.list({ platform: 'ios', appsFilter: 'user-installed' });
const ensured = await client.simulators.ensure({
  device: 'iPhone 16',
  boot: true,
});

await client.apps.open({
  app: 'com.apple.Preferences',
  platform: 'ios',
  udid: ensured.udid,
  runtime: {
    metroHost: '127.0.0.1',
    metroPort: 8081,
  },
});

const snapshot = await client.capture.snapshot({ interactiveOnly: true });

await client.sessions.close();
```

## Command escape hatch

Use `client.command()` for device commands that do not have a dedicated convenience method yet. It uses the same daemon transport path as the higher-level client methods, including session metadata, tenant/run/lease fields, remote config defaults, normalized daemon errors, and remote artifact handling.

```ts
await client.command('wait', {
  text: 'Continue',
  timeoutMs: 5_000,
});

await client.command('keyboard', {
  action: 'dismiss',
});

await client.command('clipboard', {
  action: 'write',
  text: 'hello from Node',
});

await client.command('back', {
  mode: 'system',
});
```

Supported command names:

- `wait`
- `appstate`
- `back`
- `home`
- `rotate`
- `appSwitcher` or `app-switcher`
- `keyboard`
- `clipboard`
- `alert`

## Android `installFromSource()`

```ts
const androidClient = createAgentDeviceClient({ session: 'qa-android' });

const installed = await androidClient.apps.installFromSource({
  platform: 'android',
  retainPaths: true,
  retentionMs: 60_000,
  source: { kind: 'url', url: 'https://example.com/app.apk' },
});

await androidClient.apps.open({
  platform: 'android',
  app: installed.launchTarget,
});

console.log(installed.packageName, installed.launchTarget);

if (installed.materializationId) {
  await androidClient.materializations.release({
    materializationId: installed.materializationId,
  });
}

await androidClient.sessions.close();
```

On Android, a successful `installFromSource()` response returns enough app identity to relaunch the installed app:

- `packageName`
- `launchTarget`

If the daemon cannot determine installed app identity, the request fails instead of returning an empty success payload.

## URL source rules

`installFromSource()` URL sources are intentionally limited:

- Private and loopback hosts are blocked by default.
- Archive-backed URL installs are only supported for trusted artifact services, currently GitHub Actions and EAS.
- For other hosts, prefer `source: { kind: 'path', path: ... }` so the client downloads/uploads the artifact explicitly.

Direct Android `.apk` and `.aab` URL sources can still resolve package identity from the downloaded install artifact.

## Remote Metro helpers

```ts
import {
  prepareRemoteMetro,
  stopMetroTunnel,
} from 'agent-device/metro';
import { resolveRemoteConfigProfile } from 'agent-device/remote-config';

const remoteConfig = resolveRemoteConfigProfile({
  configPath: './agent-device.remote.json',
  cwd: process.cwd(),
});

const prepared = await prepareRemoteMetro({
  projectRoot: remoteConfig.profile.metroProjectRoot!,
  kind: remoteConfig.profile.metroKind ?? 'auto',
  publicBaseUrl: remoteConfig.profile.metroPublicBaseUrl!,
  proxyBaseUrl: remoteConfig.profile.metroProxyBaseUrl,
  proxyBearerToken: remoteConfig.profile.metroBearerToken,
  profileKey: remoteConfig.resolvedPath,
});

console.log(prepared.iosRuntime, prepared.androidRuntime);

await stopMetroTunnel({
  projectRoot: remoteConfig.profile.metroProjectRoot!,
  profileKey: remoteConfig.resolvedPath,
});
```

Use `agent-device/remote-config` for profile loading and path resolution, `agent-device/metro` for Metro preparation and tunnel lifecycle, and `agent-device/contracts` when a server consumer needs daemon request or runtime contract types.
