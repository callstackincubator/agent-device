# Android Snapshot Helper

Small instrumentation APK used to capture Android accessibility snapshots without relying on
`uiautomator dump`'s fixed idle wait behavior. The helper enables Android's interactive-window
retrieval flag and serializes every accessible window root returned by `UiAutomation.getWindows()`
so keyboards and system overlays can appear in the same snapshot. If interactive window roots are
unavailable, it falls back to the active-window root.

The helper is intentionally provider-neutral. Local `adb`, cloud ADB tunnels, and remote device
providers can all install and run the same APK as long as they can execute ADB-style operations.

## Build

```sh
sh ./scripts/build-android-snapshot-helper.sh 0.13.3 .tmp/android-snapshot-helper
```

The build uses Android SDK command-line tools directly. It expects `ANDROID_HOME` or
`ANDROID_SDK_ROOT` to point at an SDK with `platforms/android-36` and matching build tools.

## Run

```sh
adb install -r -t .tmp/android-snapshot-helper/agent-device-android-snapshot-helper-0.13.3.apk
adb shell am instrument -w \
  -e waitForIdleTimeoutMs 500 \
  -e timeoutMs 8000 \
  -e maxDepth 128 \
  -e maxNodes 5000 \
  com.callstack.agentdevice.snapshothelper/.SnapshotInstrumentation
```

`maxDepth` also caps recursive traversal depth inside the helper.

## Output Contract

The APK emits instrumentation status records using
`agentDeviceProtocol=android-snapshot-helper-v1`.

Each XML chunk is sent with:

- `outputFormat=uiautomator-xml`
- `chunkIndex`
- `chunkCount`
- `payloadBase64`

The final instrumentation result includes:

- `ok=true`
- `helperApiVersion=1`
- `waitForIdleTimeoutMs`
- `timeoutMs`
- `maxDepth`
- `maxNodes`
- `rootPresent`
- `captureMode` (`interactive-windows` or `active-window`)
- `windowCount`
- `nodeCount`
- `truncated`
- `elapsedMs`

Failures return `ok=false`, `errorType`, and `message` in the final result.
