# Android MultiTouch Helper

Small instrumentation APK used to inject Android two-pointer gestures through
`UiAutomation.injectInputEvent`. The helper accepts a compact base64 JSON payload so local ADB,
remote ADB tunnels, and remote providers that allow `adb install -t` plus `am instrument` can use
the same contract.

The helper is separate from `android-snapshot-helper` because the payload and output protocol are
gesture-specific. The install/version/cache lifecycle should stay aligned with the snapshot helper.

## Build

```sh
VERSION="$(node -p 'require("./package.json").version')"
sh ./scripts/build-android-multitouch-helper.sh "$VERSION" .tmp/android-multitouch-helper
```

## Run

```sh
PAYLOAD="$(printf '%s' '{"kind":"transform","x":672,"y":1500,"dx":80,"dy":-40,"scale":1.8,"degrees":35,"durationMs":700}' | base64)"
adb install -r -t ".tmp/android-multitouch-helper/agent-device-android-multitouch-helper-$VERSION.apk"
adb shell am instrument -w \
  -e payloadBase64 "$PAYLOAD" \
  com.callstack.agentdevice.multitouchhelper/.MultiTouchInstrumentation
```

## Output Contract

The APK emits instrumentation result records using
`agentDeviceProtocol=android-multitouch-helper-v1`.

Successful results include:

- `ok=true`
- `helperApiVersion=1`
- `kind` (`pinch`, `rotate`, or `transform`)
- `injectedEvents`
- `elapsedMs`

Failures return `ok=false`, `errorType`, and `message`.
