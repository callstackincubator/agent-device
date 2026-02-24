---
title: Known Limitations
---

# Known Limitations

Platform constraints that affect automation behavior.

## iOS: "Allow Paste" dialog suppressed under XCUITest

iOS 16+ shows an "Allow Paste" system prompt when an app reads `UIPasteboard.general` in the foreground. When an app is launched or activated through the XCUITest runner (which `agent-device` uses for iOS), the iOS runtime detects the testing context and silently grants pasteboard access — the prompt never appears.

This is an Apple platform constraint that affects all XCUITest-based automation tools.

**Workarounds:**

- **Pre-fill the pasteboard via simctl** — set clipboard content without triggering the dialog:
  ```bash
  echo "some text" | xcrun simctl pbcopy booted
  ```
- **Test the dialog manually** — the "Allow Paste" UX cannot be exercised through XCUITest-based automation.

## Android: non-ASCII text over `adb shell input text`

Some Android system images fail to inject non-ASCII text (for example Chinese characters or emoji) through `adb shell input text`.

**Workarounds:**

- **Use an ADB keyboard IME for test runs**:
  ```bash
  adb -s <serial> install <path-to-adbkeyboard.apk>
  adb -s <serial> shell ime enable com.android.adbkeyboard/.AdbIME
  adb -s <serial> shell ime set com.android.adbkeyboard/.AdbIME
  ```
- **Use trusted APK sources only** (official project: https://github.com/senzhk/ADBKeyBoard or F-Droid: https://f-droid.org/packages/com.android.adbkeyboard/), and verify checksum/signature before installing.
- **Revert to your normal IME after automation**:
  ```bash
  adb -s <serial> shell ime list -s
  adb -s <serial> shell ime set <previous-ime-id>
  ```
