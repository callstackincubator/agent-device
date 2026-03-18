# Running agent-device commands on Device Farms (Exploration)

## Summary

This document explores how `agent-device` (`ad`) commands can be executed as E2E tests on cloud device farms like **AWS Device Farm** and **BrowserStack**. The short answer: **yes, it's feasible**, and the existing architecture already has several primitives that make this tractable.

---

## Current Architecture Advantages

### Already in place

1. **HTTP daemon with JSON-RPC** (`src/daemon/http-server.ts`) — the daemon exposes a full HTTP API (`POST /rpc`) with bearer-token auth. A test runner on a CI host can talk to a remote daemon over HTTP.

2. **Lease-based multi-tenancy** (`src/daemon/lease-registry.ts`) — allocate/heartbeat/release leases scoped by `tenantId + runId`. This is exactly what's needed when multiple CI jobs share a pool of cloud devices.

3. **Remote daemon transport** — CLI already supports `--daemon-base-url`, `--daemon-auth-token`, and `--daemon-transport http`. Tests can point at a daemon co-located with the device farm host.

4. **Typed client SDK** (`src/client.ts`) — `createAgentDeviceClient()` returns a fully typed API. E2E tests can import this directly instead of shelling out to the CLI.

5. **Existing integration tests** (`test/integration/`) — the `ios.test.ts` and `android.test.ts` files already demonstrate the exact pattern: open app → snapshot → click → assert → close. These are effectively E2E scripts.

---

## How Each Farm Works (and Fits)

### AWS Device Farm

AWS Device Farm provides **real physical devices** (Android & iOS) in the cloud. Two modes:

| Mode | How it works | Fit for agent-device |
|------|-------------|---------------------|
| **Standard Runs** | Upload a test package + app, AWS picks a device, runs your tests, returns artifacts | Medium — requires packaging `ad` + node runtime into a test bundle. Tests run inside the device host VM, so `adb`/`simctl` are available locally. |
| **Private Devices (sessions)** | Reserve a device, get remote ADB/Xcode access | High — run the `ad` daemon on a CI host, point it at the remote device via ADB-over-TCP or Xcode remote device pairing. |

#### Standard Run approach

```
┌─────────────────────────────────────────────┐
│  AWS Device Farm Host VM                    │
│                                             │
│  ┌─────────┐    adb/simctl    ┌──────────┐  │
│  │ ad daemon│ ──────────────> │ Device   │  │
│  └────┬─────┘                 └──────────┘  │
│       │                                     │
│  ┌────┴──────────────────────────────────┐  │
│  │ node test/e2e/farm-android.test.ts    │  │
│  │  uses createAgentDeviceClient()       │  │
│  │  or shells out to `ad` CLI            │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

**What's needed:**
- A test spec that boots the `ad` daemon, runs the E2E script, and collects artifacts
- Package Node.js 22+ runtime + built `agent-device` into the test bundle
- Use `DEVICEFARM_DEVICE_UDID` / `DEVICEFARM_DEVICE_PLATFORM_NAME` env vars to target the allocated device

#### Private Device / Remote ADB approach

```
┌── CI Host ──────────────┐      ┌── AWS Device Farm ──┐
│                         │      │                     │
│  ad daemon              │ ADB  │   Android device    │
│  (--daemon-server-mode  │ TCP  │   (reserved)        │
│    http)                │◄────►│                     │
│                         │      └─────────────────────┘
│  E2E test runner        │
│  (node --test)          │
└─────────────────────────┘
```

### BrowserStack App Automate

BrowserStack provides real devices accessible via **Appium**. This is a different model — you don't get raw `adb` access, you get an Appium WebDriver endpoint.

| Approach | Fit |
|----------|-----|
| **Direct Appium** | Low — `agent-device` uses raw `adb`/`simctl`, not Appium. Would need an adapter layer. |
| **BrowserStack Local + ADB tunnel** | Medium — BrowserStack's local testing binary can tunnel ADB traffic. The `ad` daemon would see the device as a local ADB device. |
| **BrowserStack App Live / Manual** | Low — interactive only, not automatable. |

**Recommendation:** BrowserStack is a better fit if an Appium-bridge adapter is built for agent-device, or if their local ADB tunnel works reliably. AWS Device Farm is a more natural fit today because it provides raw device access.

### Other Farms

| Farm | Raw ADB/simctl? | Fit |
|------|-----------------|-----|
| **Firebase Test Lab** | Yes (via gcloud CLI + flank) | High — similar to AWS Standard Runs |
| **Samsung Remote Test Lab** | Partial ADB | Medium |
| **Sauce Labs Real Devices** | Via Appium (no raw ADB) | Low without adapter |
| **Xamarin Test Cloud (App Center)** | No raw access | Low |

---

## Proposed E2E Test Structure

The existing integration tests are already close to what's needed. The key change is abstracting device provisioning:

```typescript
// test/e2e/device-farm.test.ts
import test from 'node:test';
import { createAgentDeviceClient } from '../../src/client.ts';

const client = createAgentDeviceClient({
  session: `farm-${process.env.FARM_RUN_ID ?? 'local'}`,
  platform: process.env.AD_PLATFORM as 'ios' | 'android',
  udid: process.env.AD_DEVICE_UDID,
  // If daemon is remote:
  // daemonBaseUrl: process.env.AD_DAEMON_URL,
  // daemonAuthToken: process.env.AD_DAEMON_TOKEN,
});

test('settings app lifecycle on cloud device', async () => {
  const open = await client.apps.open({ app: 'settings' });
  console.log(`Opened on device: ${open.device?.name}`);

  const snapshot = await client.capture.snapshot();
  assert(snapshot.nodes.length > 0, 'snapshot has nodes');

  await client.sessions.close();
});
```

### What needs to happen

1. **Device provisioning layer** — a thin wrapper that:
   - For AWS Device Farm: calls `aws devicefarm create-remote-access-session` or packages a standard run
   - For local: just ensures a simulator/emulator is booted (what `boot` already does)
   - Sets `AD_DEVICE_UDID` and `AD_PLATFORM` env vars for the test

2. **Farm-aware test runner script** — orchestrates:
   ```bash
   # 1. Provision device on farm
   # 2. Start ad daemon (locally or on farm host)
   # 3. Run E2E tests with node --test
   # 4. Collect artifacts (screenshots, snapshots, traces)
   # 5. Tear down device
   ```

3. **Artifact collection** — the existing `test/artifacts/` pattern + `screenshot`, `record`, `trace` commands already produce the right outputs. These just need to be uploaded to the farm's artifact store.

---

## Minimum Viable Path

The fastest way to validate this end-to-end:

### Phase 1: Run existing integration tests on AWS Device Farm (Standard Run)

1. Create a `devicefarm-testspec.yml`:
   ```yaml
   version: 0.1
   phases:
     install:
       commands:
         - nvm install 22
         - npm install -g pnpm
     pre_test:
       commands:
         - pnpm install
         - pnpm build
     test:
       commands:
         - pnpm ad boot --platform android
         - node --experimental-strip-types --test test/integration/android.test.ts
     post_test:
       commands:
         - pnpm ad close --platform android --session android-test
   artifacts:
     - test/artifacts/**/*
     - test/screenshots/**/*
   ```

2. Upload the repo + a test APK to Device Farm
3. Run and verify the existing `android.test.ts` passes on a real cloud device

### Phase 2: AWS Device Farm with remote daemon (for iOS)

Since iOS devices on AWS Device Farm support Xcode, the daemon can use the XCTest runner as it does locally. This requires:
- Bundling the pre-built `ios-runner` XCTest artifact
- Ensuring the daemon can discover the farm-allocated device via `devicectl`

### Phase 3: Structured E2E test suite

Extract the "E2E test script" concept into a reusable pattern:
- `test/e2e/scenarios/` — platform-agnostic test scenarios
- `test/e2e/farms/` — farm-specific provisioning adapters
- `test/e2e/run.ts` — orchestrator that wires provisioning → daemon → tests → artifacts

---

## Key Questions to Resolve

1. **Node.js on farm hosts** — AWS Device Farm supports custom test environments. Need to verify Node 22 is available or can be installed in the `install` phase.

2. **Daemon lifecycle on farm** — Should the daemon run on the farm host alongside the device, or on a separate CI host talking to the device remotely? Co-located is simpler.

3. **iOS on AWS** — AWS Device Farm has iOS devices, but the XCTest runner needs to be deployed. Need to verify `xcodebuild` is available on their macOS hosts.

4. **Test timeout management** — Farm runs have timeout limits (default 60min on AWS). The lease TTL system already handles this, but the test runner should respect farm timeouts.

5. **Parallelism** — AWS Device Farm can run tests on multiple devices in parallel. The multi-tenant lease system is designed for exactly this — each parallel run gets its own `tenantId + runId`.

---

## Conclusion

The architecture is well-positioned for device farm integration. The HTTP daemon, lease system, and typed client SDK mean the core automation engine doesn't need to change — only the device provisioning and test orchestration layers need to be added. AWS Device Farm is the most natural fit today due to raw ADB/Xcode access. A proof-of-concept with the existing `android.test.ts` on AWS Device Farm Standard Runs would validate the approach with minimal new code.
