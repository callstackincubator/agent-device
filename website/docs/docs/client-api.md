---
title: Typed Client
---

# Typed Client

Use `createAgentDeviceClient()` when you want to drive the daemon from application code instead of shelling out to the CLI.

For remote Metro-backed flows, import the reusable Node APIs instead of spawning the `agent-device` binary. The CLI uses the same helpers internally.

Public subpath API exposed for Node consumers:

- `agent-device/io`
  - artifact adapter types, file input refs, and file output refs
- `agent-device/metro`
  - `prepareRemoteMetro(options)`
  - `ensureMetroTunnel(options)`
  - `reloadRemoteMetro(options)`
  - `stopMetroTunnel(options)`
  - `buildIosRuntimeHints(baseUrl)`
  - `buildAndroidRuntimeHints(baseUrl)`
  - types: `PrepareRemoteMetroOptions`, `PrepareRemoteMetroResult`, `EnsureMetroTunnelOptions`, `EnsureMetroTunnelResult`, `ReloadRemoteMetroOptions`, `ReloadRemoteMetroResult`, `StopMetroTunnelOptions`, `MetroRuntimeHints`, `MetroBridgeResult`
- `agent-device/batch`
  - `runBatch(req, sessionName, invoke)`
  - `validateAndNormalizeBatchSteps(steps, maxSteps)`
  - `buildBatchStepFlags(parentFlags, stepFlags)`
  - `DEFAULT_BATCH_MAX_STEPS`
  - `BATCH_BLOCKED_COMMANDS`
  - `INHERITED_PARENT_FLAG_KEYS`
  - types: `BatchInvoke`, `BatchRequest`, `BatchStep`, `BatchStepResult`, `NormalizedBatchStep`
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
- `agent-device/android-snapshot-helper`
  - `ensureAndroidSnapshotHelper(options)`
  - `captureAndroidSnapshotWithHelper(options)`
  - `parseAndroidSnapshotHelperOutput(output)`
  - `parseAndroidSnapshotHelperXml(xml, metadata?, options?, maxNodes?)`
  - `prepareAndroidSnapshotHelperArtifactFromManifestUrl(options)`
  - `verifyAndroidSnapshotHelperArtifact(artifact)`
  - types: `AndroidAdbExecutor`, `AndroidSnapshotHelperArtifact`, `AndroidSnapshotHelperManifest`, `AndroidSnapshotHelperOutput`, `AndroidSnapshotHelperParsedSnapshot`

The `contracts`, `selectors`, `finders`, `install-source`, `android-apps`, `artifacts`, `batch`, `metro`, `remote-config`, and `io` subpaths remain available for compatibility. The former hosted-runtime subpaths `agent-device/commands`, `agent-device/backend`, `agent-device/testing/conformance`, and `agent-device/observability` are no longer published.

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

## Android snapshot helper providers

Remote Android providers should import `agent-device/android-snapshot-helper` and inject their own
ADB-shaped executor. The executor receives arguments after `adb`, so local callers may wrap
`adb -s <serial>`, while cloud providers can route the same operations through an ADB tunnel.

```ts
import {
  captureAndroidSnapshotWithHelper,
  ensureAndroidSnapshotHelper,
  parseAndroidSnapshotHelperXml,
  prepareAndroidSnapshotHelperArtifactFromManifestUrl,
} from 'agent-device/android-snapshot-helper';

const artifact = await prepareAndroidSnapshotHelperArtifactFromManifestUrl({
  manifestUrl:
    'https://github.com/callstackincubator/agent-device/releases/download/v0.13.3/agent-device-android-snapshot-helper-0.13.3.manifest.json',
});

await ensureAndroidSnapshotHelper({
  adb: runProviderAdb,
  artifact,
  installPolicy: 'missing-or-outdated',
});

const output = await captureAndroidSnapshotWithHelper({
  adb: runProviderAdb,
  timeoutMs: 8000,
});

const snapshot = parseAndroidSnapshotHelperXml(output.xml, output.metadata);
```

Helper captures report `metadata.captureMode` as `interactive-windows` when Android returns
interactive window roots, or `active-window` when the helper falls back to
`getRootInActiveWindow()`. `metadata.windowCount` is the number of serialized roots.

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

`client.observability.perf()` returns daemon-shaped JSON so local and remote transports expose the same metrics payload. On Android, `data.metrics.fps.droppedFramePercent` is the primary frame-smoothness value. It is derived from the current `adb shell dumpsys gfxinfo <package> framestats` window and represents rendered frames that missed Android's frame deadline, not recording FPS. Android frame samples also include `windowStartedAt`, `windowEndedAt`, and `worstWindows` so agents can correlate dropped-frame clusters with logs, network entries, and their own session actions. A successful read resets Android frame stats; `open <app>` resets the Android frame window too, so agents can call `perf`, perform a transition or gesture, then call `perf` again to inspect that focused window.

`client.recording.record({ action: 'start', path, quality: 5 })` starts a smaller 50% resolution video; omit `quality` to keep native/current resolution.

## Batch orchestration for custom transports

Use `agent-device/batch` when a bridge or in-process runner receives daemon-shaped requests but owns command dispatch itself. The helper keeps validation, inherited flags, serial execution, partial results, and error envelopes aligned with the daemon batch command.

```ts
import { runBatch } from 'agent-device/batch';
import type { BatchRequest } from 'agent-device/batch';
import type { DaemonResponse } from 'agent-device/contracts';

async function handleBatch(req: BatchRequest): Promise<DaemonResponse> {
  return await runBatch(req, req.session ?? 'default', async (stepReq) => {
    try {
      return { ok: true, data: await dispatch(stepReq) };
    } catch (error) {
      return bridgeErrorToDaemonResponse(error);
    }
  });
}
```

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
- For compatible remote daemons that resolve CI artifacts server-side, pass a GitHub Actions artifact source:

```ts
await client.apps.installFromSource({
  platform: 'android',
  source: {
    kind: 'github-actions-artifact',
    owner: 'acme',
    repo: 'mobile',
    artifactId: 1234567890,
  },
});
```

Remote daemons may also support `{ kind: 'github-actions-artifact', owner, repo, artifactName }` or `{ kind: 'github-actions-artifact', owner, repo, runId, artifactName }`. The local client preserves these payloads and does not perform GitHub authentication or artifact download.

Direct Android `.apk` and `.aab` URL sources can still resolve package identity from the downloaded install artifact. Trusted GitHub Actions and EAS archive URLs may contain one installable `.apk`, `.aab`, `.ipa`, or iOS `.app` tar archive.

## Remote Metro helpers

```ts
import {
  prepareRemoteMetro,
  reloadRemoteMetro,
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

await reloadRemoteMetro({
  runtime: prepared.iosRuntime,
});

await stopMetroTunnel({
  projectRoot: remoteConfig.profile.metroProjectRoot!,
  profileKey: remoteConfig.resolvedPath,
});
```

Use `agent-device/remote-config` for profile loading and path resolution, `agent-device/metro` for Metro preparation, reload, and tunnel lifecycle, and `agent-device/contracts` when a server consumer needs daemon request or runtime contract types. For bridged remote Metro, `proxyBaseUrl` is the bridge origin and `publicBaseUrl` is optional; the bridge descriptor supplies cloud iOS wildcard HTTPS hints and Android runtime-route hints. `reloadRemoteMetro()` calls Metro's `/reload` endpoint, matching the terminal `r` reload path for connected React Native apps.

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
