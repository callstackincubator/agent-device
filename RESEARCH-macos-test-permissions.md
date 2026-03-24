# Research: macOS XCTest Permission Requirements & Alternatives

## Problem

When running the XCUITest runner on macOS (desktop apps), the system prompts for
**Accessibility** and/or **Screen Recording** TCC (Transparency, Consent &
Control) permissions. These prompts require manual user interaction, which blocks
headless/remote execution scenarios.

On iOS simulators this is not an issue — XCUITest runs within a special test
host context where TCC permissions are automatically granted by the simulator
runtime.

---

## 1. What Permissions Does XCUITest Need on macOS?

XCUITest on macOS uses the Accessibility subsystem under the hood. The key
operations and their permission requirements:

| Operation | Permission Required | TCC Service Key |
|---|---|---|
| `XCUIApplication.snapshot()` — reading the UI element tree | **Accessibility** | `kTCCServiceAccessibility` |
| `XCUIScreen.main.screenshot()` — capturing screenshots | **Screen Recording** | `kTCCServiceScreenCapture` |
| Tap/click/type interactions via XCUITest | **Accessibility** | `kTCCServiceAccessibility` |
| Screen recording (ScreenRecorder in runner) | **Screen Recording** | `kTCCServiceScreenCapture` |

The process that needs these permissions is the **XCTest runner process**
(`xcodebuild` / the test host binary), not the app under test.

### Why This Happens

- macOS enforces TCC on all processes accessing accessibility APIs
- Each new build can change the code signature, causing macOS to prompt again
- The runner is codesigned ad-hoc (`codesign --force --sign -`) in
  `runner-macos-products.ts`, which means the identity changes on each build

---

## 2. Can Permissions Be Pre-Granted?

### Option A: `tccutil` (Apple built-in)

`tccutil` only supports **resetting** permissions, not granting them:
```bash
tccutil reset Accessibility com.apple.dt.Xcode
```
**Verdict: Cannot grant permissions. Not useful.**

### Option B: Direct TCC.db Manipulation

The TCC database is at `/Library/Application Support/com.apple.TCC/TCC.db`
(system-level) and `~/Library/Application Support/com.apple.TCC/TCC.db`
(user-level). You can insert rows:

```sql
INSERT INTO access VALUES(
  'kTCCServiceAccessibility',
  'com.apple.dt.Xcode',
  0, 2, 4, 1, NULL, NULL, 0,
  'UNUSED', NULL, 0, 0
);
```

**Verdict: Requires SIP (System Integrity Protection) to be disabled.** This is
a non-starter for most users and production environments. CI runners like GitHub
Actions have SIP enabled by default.

### Option C: MDM / PPPC Profiles

Apple supports Privacy Preferences Policy Control (PPPC) profiles that can
silently grant TCC permissions. These are `.mobileconfig` files deployed via MDM:

```xml
<key>Services</key>
<dict>
  <key>Accessibility</key>
  <array>
    <dict>
      <key>Identifier</key>
      <string>com.apple.dt.Xcode</string>
      <key>IdentifierType</key>
      <string>bundleID</string>
      <key>Allowed</key>
      <true/>
    </dict>
  </array>
</dict>
```

**Verdict: Works but requires MDM enrollment.** Not practical for individual
developer machines. Could work for dedicated CI fleets managed via MDM (e.g.,
Jamf, Mosyle). Screen Recording permissions specifically require user approval
even with MDM on macOS Sequoia+.

### Option D: Stable Code Signing

If the runner binary is signed with a stable Developer ID certificate (not
ad-hoc), macOS may remember the permission grant across builds.

**Current state:** `runner-macos-products.ts` does ad-hoc signing
(`codesign --force --sign -`), which means every build produces a new identity.

**Verdict: Partially helpful.** Signing with a stable identity would prevent
re-prompting after the first manual grant, but still requires the initial manual
acceptance. This is the most practical improvement for local dev scenarios.

### Option E: `xcodebuild` Flags

There are no `xcodebuild` flags that bypass TCC permissions. The
`-allowProvisioningUpdates` flag is unrelated (it's for provisioning profiles).

**Verdict: Not available.**

---

## 3. Alternatives to XCUITest for the UI Tree

### Alternative A: macOS Accessibility API (`AXUIElement`)

The native accessibility API can query the UI tree:
```swift
let app = AXUIElementCreateApplication(pid)
var value: CFTypeRef?
AXUIElementCopyAttributeValue(app, kAXChildrenAttribute as CFString, &value)
```

**Problem: Also requires Accessibility TCC permission.** The `AXUIElement` API
is the underlying mechanism that XCUITest uses. Same permission, same problem.

**Verdict: Same permission requirement as XCUITest. No advantage.**

### Alternative B: AppleScript / `osascript`

```applescript
tell application "System Events"
  tell process "Safari"
    entire contents of window 1
  end tell
end tell
```

**Problem: Also requires Accessibility permission** (System Events needs it).
Additionally, the UI tree from AppleScript is less detailed than XCUITest and
would require a separate parsing layer.

**Verdict: Same permission requirement, worse output quality.**

### Alternative C: `NSAccessibility` Protocol (In-Process)

If you could inject code into the target app, `NSAccessibility` protocol methods
are available without TCC because the app is querying its own accessibility tree.

**Problem:** Requires code injection or an accessibility plugin in the target
app. This is impractical for testing arbitrary third-party apps.

**Verdict: Only works for apps you control. Not a general solution.**

### Alternative D: Screen-Only Approach (Vision/OCR)

Skip the accessibility tree entirely and use only screenshots + vision models
for UI understanding.

**Problem:** Still needs Screen Recording permission for screenshots. Also loses
the structured element data (refs, labels, identifiers, hit-testability) that
make interactions reliable.

**Verdict: Still needs Screen Recording. Loses structural data quality.**

---

## 4. AX Snapshot Backend (Historical)

The codebase docs (`website/docs/docs/snapshots.md`) mention an `ax` backend:
> `ax`: fast accessibility tree, may miss details, requires Accessibility
> permission; simulator-only.

This was **documented but never implemented** in the actual codebase. The
`SnapshotState.backend` type only allows `'xctest' | 'android'`. The replay
healing system has backward-compat code to strip legacy `--backend` flags.

**Key insight: The AX backend would NOT solve the permission problem.** It would
use `AXUIElement` APIs which require the same Accessibility TCC permission that
XCUITest needs. On iOS simulators it was marked "simulator-only" because
simulators auto-grant these permissions.

**Verdict: Reintroducing AX snapshots would not help with macOS permissions.**

---

## 5. Recommended Approaches

### Approach 1: Stable Code Signing (Low effort, partial fix)

Change `runner-macos-products.ts` to sign with a stable identity instead of
ad-hoc. This way, after the **first** manual grant, permissions persist across
rebuilds.

- Modify `repairMacOsRunnerProductsIfNeeded` to use a Developer ID or stable
  self-signed certificate
- Permissions only need to be granted once per machine
- **Limitation:** Still requires initial manual acceptance

### Approach 2: One-Time Setup Script (Medium effort, good UX)

Provide a setup script/command that:
1. Checks if permissions are granted
2. If not, opens System Preferences to the right pane
3. Guides the user through the one-time grant
4. Verifies the grant succeeded

Combined with Approach 1 (stable signing), this would be a one-time setup.

### Approach 3: TCC Pre-Grant for CI (Medium effort, CI-only)

For CI environments specifically:
- Document how to use `tccutil.py` or TCC.db manipulation on runners with SIP
  disabled
- Provide a PPPC `.mobileconfig` profile for MDM-managed CI fleets
- GitHub Actions macOS runners: reference
  [actions/runner-images#1567](https://github.com/actions/runner-images/issues/1567)
  for the known limitation

### Approach 4: Hybrid Screenshot + Structured Data (High effort, complete fix)

For fully headless operation without any permissions:
- Use screenshots (which also need Screen Recording...) — this doesn't fully
  solve it either

**Note:** There is fundamentally no way to access another app's UI tree on macOS
without Accessibility permission. This is an OS-level security boundary.

---

## 6. Conclusion

**The macOS TCC permission requirement is an OS-level constraint that cannot be
fully bypassed.** Every approach to reading another application's UI element tree
(XCUITest, AXUIElement, AppleScript/System Events) requires Accessibility
permission. Screenshots require Screen Recording permission.

**Reintroducing the AX snapshot backend would not help** — it uses the same
underlying accessibility APIs and has the same permission requirements.

### Best practical path forward:

1. **Stable code signing** so permissions persist across builds (eliminate
   re-prompting)
2. **One-time setup documentation/tooling** to guide users through the initial
   grant
3. **CI-specific guidance** for pre-granting via MDM profiles or TCC.db on
   SIP-disabled runners
4. **Consider making macOS XCUITest permissions a first-run setup step** similar
   to how other macOS automation tools (Hammerspoon, Alfred, etc.) handle it

### What will NOT work:

- AX snapshot backend (same permissions needed)
- Any `xcodebuild` flags (none exist for TCC bypass)
- `tccutil` (can only reset, not grant)
- AppleScript (same Accessibility permission needed)
- In-process NSAccessibility (only works for apps you own)
