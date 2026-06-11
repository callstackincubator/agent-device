# Changelog

## Unreleased

- iOS: `snapshot` now recovers from a sparse accessibility tree. When the public `XCUIElement.snapshot()` traversal collapses to only structural containers (application/window/other) while the screen is rendering content — common on React Native apps — the runner falls back to a query-based (`XCUIElementQuery`) flat traversal so `testID`s and on-screen controls remain visible instead of returning a 2–3 node tree. The recovered payload is marked `truncated` and carries an explanatory `message`.

## 0.15.0

- Breaking: `apps` discovery and public app-list helpers now default to user-installed apps. Use `--all` or `filter: 'all'` to include system/OEM apps.
- Breaking: removed the `agent-device/android-apps` public subpath. Use the Android app helpers from `agent-device/android-adb`.
- Breaking: removed the `agent-device/daemon` public subpath. Use `agent-device/contracts` for daemon request/response types.
- Breaking: removed public local ADB bypass/selection helpers such as `spawnAndroidAdbBySerial` and `resolveAndroidAdbProvider`; use `createLocalAndroidAdbProvider(device)` or pass providers directly to the helpers from `agent-device/android-adb`.
- Added Android ADB provider helpers for exec, stream, clipboard, keyboard, app lifecycle, logcat, and port reverse workflows.
