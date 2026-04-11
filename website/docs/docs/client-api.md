---
title: Typed Client
---

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
- `agent-device/selectors`
  - `parseSelectorChain(expression)`
  - `tryParseSelectorChain(expression)`
  - `resolveSelectorChain(nodes, chain, options)`
  - `findSelectorChainMatch(nodes, chain, options)`
  - `formatSelectorFailure(chain, diagnostics, options)`
  - `isNodeVisible(node)`
  - `isSelectorToken(token)`
  - `isNodeEditable(node, platform)`
  - types: `Selector`, `SelectorChain`, `SelectorDiagnostics`, `SelectorResolution`

## Basic usage

```ts
import { createAgentDeviceClient } from 'agent-device';

const client = createAgentDeviceClient({
  session: 'qa-ios',
  lockPolicy: 'reject',
  lockPlatform: 'ios',
  // Optional: loads profile defaults for daemon-backed requests. Per-call options override it.
  remoteConfig: './agent-device.remote.json',
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

## Command methods

Use `client.command.<method>()` for command-level device actions. It uses the same daemon transport path as the higher-level client methods, including session metadata, tenant/run/lease fields, client-level remote config defaults, normalized daemon errors, and remote artifact handling.

Results are daemon-shaped objects with typed known fields, so command semantics stay aligned with the CLI.

```ts
await client.command.wait({
  text: 'Continue',
  timeoutMs: 5_000,
});

await client.command.keyboard({
  action: 'dismiss',
});

await client.command.clipboard({
  action: 'write',
  text: 'hello from Node',
});

await client.command.back({
  mode: 'system',
});

await client.command.appSwitcher();
```

Supported command methods:

- `wait`
- `appState`
- `back`
- `home`
- `rotate`
- `appSwitcher`
- `keyboard`
- `clipboard`
- `alert`

Additional CLI-backed methods are exposed on their domain groups with typed option objects so Node consumers do not need to build raw daemon requests:

- `client.devices.boot()`
- `client.apps.push()`
- `client.apps.triggerEvent()`
- `client.capture.diff()`
- `client.interactions.click()`, `press()`, `longPress()`, `swipe()`, `focus()`, `type()`, `fill()`, `scroll()`, `pinch()`, `get()`, `is()`, `find()`
- `client.replay.run()` and `client.replay.test()`
- `client.batch.run()`
- `client.observability.perf()`, `logs()`, and `network()`
- `client.recording.record()` and `client.recording.trace()`
- `client.settings.update()`

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

## Selector helpers

Use `agent-device/selectors` when a remote daemon or bridge needs to parse and match selector expressions without deep-importing daemon internals. Matching is platform-aware because role normalization and editability checks differ by backend.

```ts
import { findSelectorChainMatch, parseSelectorChain } from 'agent-device/selectors';

const chain = parseSelectorChain('role=button label="Continue" visible=true');

const match = findSelectorChainMatch(snapshot.nodes, chain, {
  platform: 'android',
  requireRect: true,
});

if (!match) {
  // Build a daemon-shaped error with formatSelectorFailure(...) if needed.
}
```
