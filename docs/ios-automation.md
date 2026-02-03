# iOS UI Automation Strategy (v1)

## Goal
Provide robust element-level interactions for AI agents on iOS by combining a fast macOS Accessibility (AX) snapshot tool for simulators with an XCTest runner for interactions and fallbacks.

## Why this approach
- Apple’s official UI automation layer is XCUITest/XCUI, which runs as an XCTest bundle on device/simulator.
- macOS Accessibility (AX) can read the simulator UI tree quickly without launching XCTest.
- Tools like Appium and Maestro use an on-device XCTest runner and talk to it over HTTP.
- For real devices, code signing is required, so a local build/sign step is unavoidable.

## Experience targets
- First run: build and cache the runner via `xcodebuild`.
- Subsequent runs: reuse cached artifacts per Xcode version + runtime.
- Simulators: allow prebuilt runner when compatible.
- Devices: always require local signing.

## Implementation plan (condensed)
1. **AX snapshot tool**
   - `ios-runner/AXSnapshot` SwiftPM CLI that reads the simulator accessibility tree via AX.
   - Used for fast `snapshot` output and interactive element discovery.
2. **Runner project**
   - `ios-runner/` Xcode project with one XCTest target.
   - Minimal HTTP server inside tests to accept JSON commands (Maestro uses a long-running XCTest that serves HTTP and exposes view hierarchy and actions).
   - Protocol is documented in `docs/ios-runner-protocol.md`.
3. **Build + cache**
   - Build via `xcodebuild build-for-testing` and run via `test-without-building`.
   - Cache artifacts under `~/.agent-device/ios-runner/<xcode-version>/<runtime>`.
4. **Node adapter**
   - Add an iOS automation adapter that:
     - Runs the AX snapshot tool on simulators for fast tree dumps.
     - Ensures runner is built/available.
     - Starts runner for the specific device/simulator.
     - Sends commands (tap, type, swipe, find, list elements) over HTTP.
5. **Fallbacks and hybrid snapshots**
   - Default snapshot backend is `hybrid` because it provides the best speed vs correctness trade-off:
     AX is fast but can miss UI details, while XCTest is slower but more complete. Hybrid uses the fast AX snapshot
     first, then scoped XCTest fill for empty containers (tab bars/toolbars/groups) to improve parity while staying fast.
   - Performance: hybrid only triggers XCTest when empty containers are detected, and scopes each call with `-s`
     to limit tree size. Pure AX remains the fastest option if you don't need fill behavior.
   - Use `trace start [path]` / `trace stop [path]` to capture AX/XCTest logs for debugging snapshot issues.
   - If AX snapshot is unavailable, use the XCTest backend directly.
   - If runner not available, fall back to `simctl`/`devicectl` capabilities.

## Notes
- Prebuilt runners can be distributed for simulators, but are sensitive to Xcode/runtime versions.
- Real devices always need user signing.

## References
- Appium’s XCUITest driver uses `build-for-testing` + `test-without-building` and supports prebuilt runners for faster startup.
- Maestro’s iOS driver runs an XCTest with an HTTP server to serve view hierarchy and actions; it separates UI automation (XCTest) from device management (simctl/devicectl).
