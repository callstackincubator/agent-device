# Changelog

## 0.15.3

- Added HarmonyOS platform support with full device automation capabilities.
- Added HDC (HarmonyOS Device Connector) backend for device discovery, app lifecycle, and UI automation.
- Added `--platform harmonyos` flag to all relevant commands (devices, apps, open, close, snapshot, screenshot, press, etc.).
- Added `--module` flag to `open` command for HarmonyOS apps that require explicit module name (e.g., Xiaohongshu needs `--module redbook`).
- Added ArkUI hierarchy parser for HarmonyOS accessibility snapshots (dumpLayout JSON output).
- Added HarmonyOS alert detection based on snapshot analysis (dialog/alert/popup patterns).
- Added HarmonyOS clipboard support via uitest uiInput getClipboard/setClipboard.
- Added HarmonyOS settings control via param tool (wifi, airplane, location, animations, bluetooth, etc.).
- Added HarmonyOS device discovery via `hdc list targets` command.
- Added uitest-based input actions: press, swipe, scroll, longPress, type, key events.
- Added uitest-based screenshot capture with display id detection.

## 0.15.0

- Breaking: `apps` discovery and public app-list helpers now default to user-installed apps. Use `--all` or `filter: 'all'` to include system/OEM apps.
- Breaking: removed the `agent-device/android-apps` public subpath. Use the Android app helpers from `agent-device/android-adb`.
- Breaking: removed the `agent-device/daemon` public subpath. Use `agent-device/contracts` for daemon request/response types.
- Breaking: removed public local ADB bypass/selection helpers such as `spawnAndroidAdbBySerial` and `resolveAndroidAdbProvider`; use `createLocalAndroidAdbProvider(device)` or pass providers directly to the helpers from `agent-device/android-adb`.
- Added Android ADB provider helpers for exec, stream, clipboard, keyboard, app lifecycle, logcat, and port reverse workflows.
