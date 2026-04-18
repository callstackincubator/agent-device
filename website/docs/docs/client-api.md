---
title: Typed Client
---

# Typed Client

Use `createAgentDeviceClient()` when you want to drive the daemon from application code instead of shelling out to the CLI.

For remote Metro-backed flows, import the reusable Node APIs instead of spawning the `agent-device` binary. The CLI uses the same helpers internally.

Public subpath API exposed for Node consumers:

- `agent-device/commands`
  - runtime command namespaces for command semantics as they migrate out of the daemon and CLI layers
- `agent-device/backend`
  - backend primitive and policy-gated capability types for local and hosted adapters
- `agent-device/io`
  - artifact adapter types, file input refs, and file output refs
- `agent-device/testing/conformance`
  - conformance suites for backend/runtime parity across capture, selectors, interactions, and apps
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
  - types: `Selector`, `SelectorChain`, `SelectorDiagnostics`, `SelectorResolution`, `SnapshotNode`
- `agent-device/finders`
  - `findBestMatchesByLocator(nodes, locator, query, requireRectOrOptions)`
  - `normalizeRole(value)`
  - `normalizeText(value)`
  - `parseFindArgs(args)`
  - types: `FindLocator`, `FindMatchOptions`, `SnapshotNode`
- `agent-device/install-source`
  - `ARCHIVE_EXTENSIONS`
  - `isBlockedIpAddress(address)`
  - `isBlockedSourceHostname(hostname)`
  - `isTrustedInstallSourceUrl(sourceUrl)`
  - `materializeInstallablePath(options)`
  - `validateDownloadSourceUrl(url)`
  - types: `MaterializeInstallSource`, `MaterializedInstallable`
- `agent-device/artifacts`
  - `resolveAndroidArchivePackageName(archivePath)`

The `contracts`, `selectors`, `finders`, `install-source`, `android-apps`, `artifacts`, `metro`, and `remote-config` subpaths remain available for compatibility. New command-level integrations should prefer the runtime boundary: `agent-device/commands`, `agent-device/backend`, and `agent-device/io`.

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

## Runtime command API

Use `createAgentDevice()` when you want command semantics without the daemon RPC
client. The runtime takes an explicit backend and IO adapter, so service code can
avoid accidental local filesystem or local device access. If no session store is
provided, the runtime uses an isolated in-memory store.

```ts
import {
  createAgentDevice,
  createLocalArtifactAdapter,
  createMemorySessionStore,
  localCommandPolicy,
  selector,
} from 'agent-device';

const device = createAgentDevice({
  backend,
  artifacts: createLocalArtifactAdapter(),
  sessions: createMemorySessionStore([{ name: 'default' }]),
  policy: localCommandPolicy(),
});

await device.capture.screenshot({
  session: 'default',
  out: { kind: 'path', path: './screen.png' },
  maxSize: 1024,
});

await device.selectors.waitForText('Ready', { session: 'default', timeoutMs: 5_000 });
await device.interactions.click(selector('label=Continue'), { session: 'default' });
await device.apps.open({ session: 'default', app: 'com.example' });
```

Implemented runtime namespaces are currently:

- `capture`: `screenshot`, `diffScreenshot`, `snapshot`, `diffSnapshot`
- `selectors`: `find`, `get`, `getText`, `getAttrs`, `is`, `isVisible`, `isHidden`, `wait`, `waitForText`
- `interactions`: `click`, `press`, `fill`, `typeText`, `focus`, `longPress`, `swipe`, `scroll`, `pinch`
- `apps`: `open`, `close`, `list`, `state`, `push`, `triggerEvent`
- `admin`: `devices`, `boot`, `ensureSimulator`, `install`, `reinstall`, `installFromSource`
- `recording`: `record`, `trace`
- `observability`: `logs`, `network`, `perf` (`createCommandRouter()` dispatches these as `diagnostics.logs`, `diagnostics.network`, and `diagnostics.perf`)

Commands that have not migrated are tracked in `commandCatalog` instead of being
exposed as throwing methods.

Backend authors can use `runCommandConformance()` or `assertCommandConformance()` from
`agent-device/testing/conformance` to verify capture, selector, interaction, app,
admin, recording, and diagnostics semantics against a prepared fixture app or
test backend.

Use `createCommandRouter()` from `agent-device/commands` as the recommended
transport boundary for hosted adapters. The router applies command dispatch,
error normalization, and per-request runtime construction without exposing
daemon internals. Router-level `batch` dispatches its nested steps through the
same router path so command policy and error formatting still run for each step.
Diagnostics payload redaction is best-effort: structured JSON bodies are
redacted recursively, and non-JSON payloads are sanitized with string-pattern
fallbacks before truncation.

## Command methods

Use `client.command.<method>()` for command-level device actions. It uses the same daemon transport path as the higher-level client methods, including session metadata, tenant/run/lease fields, normalized daemon errors, and remote artifact handling.

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

`client.recording.record({ action: 'start', path, quality: 5 })` starts a smaller 50% resolution video; omit `quality` to keep native/current resolution.

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
- For existing reachable artifact URLs, use `source: { kind: 'url', url: ... }`.
- For local artifacts, use `source: { kind: 'path', path: ... }` or the CLI `install`/`reinstall` commands.

Direct Android `.apk` and `.aab` URL sources can still resolve package identity from the downloaded install artifact. Trusted GitHub Actions and EAS archive URLs may contain one installable `.apk`, `.aab`, `.ipa`, or iOS `.app` tar archive.

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
  proxyBaseUrl: remoteConfig.profile.metroProxyBaseUrl,
  proxyBearerToken: remoteConfig.profile.metroBearerToken,
  bridgeScope: {
    tenantId: remoteConfig.profile.tenant!,
    runId: remoteConfig.profile.runId!,
    leaseId: remoteConfig.profile.leaseId!,
  },
  profileKey: remoteConfig.resolvedPath,
});

console.log(prepared.iosRuntime, prepared.androidRuntime);

await stopMetroTunnel({
  projectRoot: remoteConfig.profile.metroProjectRoot!,
  profileKey: remoteConfig.resolvedPath,
});
```

Use `agent-device/remote-config` for profile loading and path resolution, `agent-device/metro` for Metro preparation and tunnel lifecycle, and `agent-device/contracts` when a server consumer needs daemon request or runtime contract types. For bridged remote Metro, `proxyBaseUrl` is the bridge origin and `publicBaseUrl` is optional; the bridge descriptor supplies cloud iOS wildcard HTTPS hints and Android runtime-route hints.

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
