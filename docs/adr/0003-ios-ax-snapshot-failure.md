# ADR 0003: iOS AX Snapshot Failure Handling

## Status

Accepted

## Context

iOS XCTest can fail hierarchy capture with `kAXErrorIllegalArgument` when an accessibility tree is
too deep to serialize. Appium's XCUITest guidance documents the practical depth limit: callers may
raise `snapshotMaxDepth` only up to `62`, and elements at depth `63` or greater cannot be returned by
XCTest. React Native screens are a common source of this shape.

Before this ADR, Agent Device let that XCTest failure escape as a slow runner command. The daemon
could wait for the command deadline, invalidate or kill the runner session as a transport failure,
and then later commands reported `SESSION_NOT_FOUND`. The app tree may still need flattening, but a
snapshot limitation should not break screenshot, logs, app lifecycle, or direct selector commands in
the same runner session.

Maestro handles this class of failure in its iOS view hierarchy route by using a depth cap of `60`,
detecting `kAXErrorIllegalArgument`, and retrying from a child/window subtree when the app root
cannot be serialized.

## Decision

Agent Device treats iOS AX snapshot serialization failure as a typed snapshot failure, not as a
runner transport failure.

The runner snapshot path now:

- caps traversal depth at `60`, with lower user-provided `--depth` values still honored
- catches Swift errors and Objective-C exceptions from `XCUIElement.snapshot()`
- classifies `kAXErrorIllegalArgument` as `IOS_AX_SNAPSHOT_FAILED`
- retries app-root failures from `windows.firstMatch`, first child, and first `.other` subtree
- returns a partial snapshot with a warning when fallback succeeds
- returns `IOS_AX_SNAPSHOT_FAILED` with an app-side flattening hint when fallback fails

Daemon and CLI output preserve runner warnings and runner error hints. Because the error code is not
`COMMAND_FAILED`, runner-session retry and invalidation policy does not treat this typed failure as a
dead transport.

Direct iOS selector interaction remains the first path for simple selector clicks, and `find id
<value> click` now probes the runner `querySelector` path before taking a full snapshot. If the
direct probe misses or has a transport fallback condition, the normal snapshot-based find path still
executes.

## Alternatives Considered

- Flatten every problematic app screen: still useful when the screen must be fully inspectable, but
  it moves a tooling failure mode into each app codebase and does not protect other sessions.
- Copy WebDriverAgent/Appium source generation: too broad for Agent Device. The immediate need is
  typed fast failure, partial recovery, and session preservation.
- Copy Maestro's hierarchy implementation wholesale: Maestro builds a different AX model and has
  its own swizzled max-depth path. Agent Device keeps its existing snapshot model and adopts only the
  small recovery behavior that fits the runner protocol.
- Always return an empty snapshot on AX failure: simple, but ambiguous. Users need to know this is an
  iOS AX serialization limit and that app-side flattening may be required.

## Consequences

Partial fallback snapshots are explicitly marked `truncated` and include a warning. Selectors may be
less accurate against partial trees, so callers should treat screenshot as visual truth and flatten
the app-side accessibility tree when full inspectability is required.

`IOS_AX_SNAPSHOT_FAILED` should remain a snapshot-domain error. Do not add it to generic retryable
runner transport errors, and do not invalidate the runner session for it.

Future improvements can add a dedicated regression fixture for a minimal React Native tree that
reproduces the XCTest depth failure. Until then, TypeScript tests guard warning propagation, typed
error preservation, and direct `find id ... click` routing.
