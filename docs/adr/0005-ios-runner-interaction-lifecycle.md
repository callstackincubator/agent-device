# ADR 0005: iOS Runner Interaction Lifecycle

## Status

Accepted

## Context

The iOS runner is a long-lived XCTest process with an HTTP command loop. A command can appear to
complete at the daemon boundary while XCTest is already tearing down the test runner.

This was reproduced in the React Navigation playground with navigation-causing selector taps such
as `Navigate to Details` and `Back to home`. The runner resolved the button and synthesized the tap,
the app navigated, and then XCTest tried to re-resolve the original `XCUIElement`. Because the
element had disappeared, xcodebuild recorded `Failed to get matching snapshot` and ended the test
with `** TEST EXECUTE FAILED **`. The daemon had already received a successful tap response, so the
next read-only command inherited a stale cached runner.

Two older assumptions were wrong:

- A recent successful runner response proves the runner is still healthy.
- `XCUIElement.tap()` is the safest selector-tap primitive once a selector has resolved.
- A cached `XCUIApplication` target remains safe after XCTest reports that the app's accessibility
  tree cannot be serialized.

## Decision

Coordinate-first resolved element activation is the iOS/macOS selector-tap model. The runner still
uses selectors or text queries to find the semantic `XCUIElement`, but when the element has a frame,
activation taps the resolved center point instead of calling `XCUIElement.tap()`. tvOS remains
focus/remote-driven because tvOS does not support normal coordinate input.

Ready runner sessions are probed with a short `uptime` preflight before command send. The daemon
does not keep or consult a "recent success" health cache. Read-only startup commands still skip that
preflight because the first successful command is the readiness proof for a newly launched runner.
Readiness probe commands skip preflight to avoid recursion.

`uptime` is a direct runner listener probe. It is answered before command journaling, the serial
command execution queue, app activation, and main-thread XCTest dispatch. It should measure only
whether the runner is alive and accepting new HTTP requests.

Dead cached runner processes are invalidated without graceful `shutdown`. A process that already
stopped cannot answer the shutdown request, so graceful cleanup only adds stale-listener delay.

When XCTest reports a root accessibility snapshot failure such as `kAXErrorIllegalArgument`, the
runner treats the cached app target as suspect. Interactive snapshots fail closed to a truncated
root-only payload instead of issuing more flat fallback queries against the same broken tree, and
the cached `XCUIApplication` handle is cleared so the next command reacquires the target through the
normal activation path.

The snapshot surface intentionally has two AX-failure shapes. Interactive fast snapshots return a
truncated success payload with `runnerFatal` so agents can still see that AX state is unavailable
and recover with a plain screenshot plus coordinate navigation. Raw or strict snapshot paths keep
returning an error because those callers requested a faithful tree, not a lossy recovery payload.

## Consequences

Navigation-causing selector taps no longer couple command success to XCTest's post-tap element
bookkeeping. If the target disappears because navigation happened, the tap remains a normal
successful interaction and the runner should stay alive.

If xcodebuild still exits for another reason, the next command detects the stale runner through
process/liveness checks and avoids the old 15-second graceful-shutdown wait. The remaining latency is
fresh xcodebuild runner startup, not a stale transport stall.

The daemon no longer models recent success as a runner-health signal. That adds one cheap `uptime`
request before ready-session commands, but it removes a false health signal that was observed to be
unsafe.

Apps with broken accessibility trees may still be impossible for XCTest to inspect deeply, but one
failed snapshot no longer teaches the runner to keep using a suspect cached app target or to amplify
the failure by walking every interactive element query.

Future optimization work should only reduce these preflights after the runner exposes status in a
way that survives command-induced XCTest teardown and can prove the session is still serving new
requests.
