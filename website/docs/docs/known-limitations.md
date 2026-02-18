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
