# iOS UI Automation Strategy (v1)

## Goal
Provide robust element-level interactions for AI agents on iOS by running a lightweight XCUITest runner on the target simulator/device, with caching and a fallback to local builds.

## Why this approach
- Apple’s official UI automation layer is XCUITest/XCUI, which runs as an XCTest bundle on device/simulator.
- Tools like Appium and Maestro use an on-device XCTest runner and talk to it over HTTP.
- For real devices, code signing is required, so a local build/sign step is unavoidable.

## Experience targets
- First run: build and cache the runner via `xcodebuild`.
- Subsequent runs: reuse cached artifacts per Xcode version + runtime.
- Simulators: allow prebuilt runner when compatible.
- Devices: always require local signing.

## Implementation plan (condensed)
1. **Runner project**
   - `ios-runner/` Xcode project with one XCTest target.
   - Minimal HTTP server inside tests to accept JSON commands (Maestro uses a long-running XCTest that serves HTTP and exposes view hierarchy and actions).
   - Protocol is documented in `docs/ios-runner-protocol.md`.
2. **Build + cache**
   - Build via `xcodebuild build-for-testing` and run via `test-without-building`.
   - Cache artifacts under `~/.agent-device/ios-runner/<xcode-version>/<runtime>`.
3. **Node adapter**
   - Add an iOS automation adapter that:
     - Ensures runner is built/available.
     - Starts runner for the specific device/simulator.
     - Sends commands (tap, type, swipe, find, list elements) over HTTP.
4. **Fallbacks**
   - If runner not available, fall back to `simctl`/`devicectl` capabilities.

## Notes
- Prebuilt runners can be distributed for simulators, but are sensitive to Xcode/runtime versions.
- Real devices always need user signing.

## References
- Appium’s XCUITest driver uses `build-for-testing` + `test-without-building` and supports prebuilt runners for faster startup.
- Maestro’s iOS driver runs an XCTest with an HTTP server to serve view hierarchy and actions; it separates UI automation (XCTest) from device management (simctl/devicectl).
