# iOS runner protocol optimization plan

Issue #656 is now split into protocol infrastructure plus follow-up optimizations. The lifecycle
protocol makes commands identifiable, but the performance wins come from changing when the daemon
uses `uptime`, retries, invalidates sessions, and asks the runner for lifecycle status.

## Work slices

### 1. Status-before-invalidate recovery

Status: in progress on `codex/ios-runner-status-recovery`.

Goal: when a command has been sent and the HTTP response is lost, ask the runner for
`status(statusCommandId)` before invalidating the session or surfacing an ambiguous transport
failure.

Acceptance criteria:

- Post-send retryable transport failures issue one bounded `status` probe with the original
  `commandId` before session invalidation.
- `completed` with retained small response JSON returns the recovered command result without
  invalidating or resending the command.
- `failed` returns the runner failure code/message/hint instead of a generic transport failure.
- `notAccepted`, status timeout, or status transport failure preserves the existing invalidation
  behavior.
- Read-only commands whose response was not retained keep the existing retry behavior.
- Status recovery probes are short-budget and do not consume the full command timeout.

iOS simulator validation:

- Unit: `pnpm exec vitest run src/platforms/ios/__tests__/runner-command-retry.test.ts`.
- Unit bundle: `pnpm exec vitest run src/platforms/ios/__tests__/runner-client.test.ts src/platforms/ios/__tests__/runner-session.test.ts src/platforms/ios/__tests__/runner-command-retry.test.ts src/platforms/ios/__tests__/runner-provider.test.ts`.
- Build: `pnpm build:xcuitest`.
- Manual sim smoke after build:
  - `pnpm build`
  - `pnpm clean:daemon`
  - run a simple iOS simulator session against Settings with `open`, `snapshot -i`, one selector
    interaction, and `close`.
  - confirm there is no visible behavior change and diagnostics show no unexpected session
    invalidation.

### 2. Adaptive `uptime` preflight policy

Status: superseded by ADR 0005 for ready-session command execution.

Goal: reduce unnecessary readiness probes only when another health signal proves the runner is still
serving new requests. A recent successful command response is not sufficient proof: React Navigation
dogfood showed XCTest can return a successful tap response and then immediately fail the test runner
while re-resolving a navigation-disappeared element.

Acceptance criteria:

- Existing first-command/startup readiness behavior is preserved.
- Existing failed-preflight stale-session recovery is preserved.
- Repeated hot interactions do not skip `uptime` based on cached recent-success state.
- Commands that still need conservative readiness checks remain preflighted until measured.
- A transport failure after skipping preflight runs status recovery before invalidation.
- Diagnostics expose whether a command used, skipped, or recovered from a readiness preflight.

iOS simulator validation:

- Start a fresh simulator session and run one interaction: verify the first mutating command still
  preflights.
- Run a hot loop of repeated selector interactions against the same visible control: verify the
  runner remains healthy and diagnostics explain any readiness probe that was skipped.
- Compare median command latency for a hot interaction loop before and after the change. A useful
  threshold is at least one fewer runner request per hot command and no increase in failure rate.

### 3. Status-visible transport path

Goal: make `accepted` and `started` states practically observable while a command is still running.
The Swift journal already records these states, but the runner currently serializes connection
handling, so a concurrent status request can be blocked behind the command it is querying.

Acceptance criteria:

- `status` can be answered while another runner command is waiting on main-thread XCTest work.
- The status path remains journal-only and does not touch app activation, XCTest dispatch, or
  command retry logic.
- Long-running command status can report `accepted` or `started` before the command reaches a
  terminal state.
- Existing command execution remains serial where mutation ordering matters.

iOS simulator validation:

- Run a deliberately long runner command in one request.
- While it is in flight, query `status(statusCommandId)` from another request.
- Verify status returns before the long command completes and reports `accepted` or `started`.
- Verify normal command ordering is unchanged for back-to-back mutating commands.

### 4. Session invalidation reduction

Goal: avoid tearing down otherwise healthy runner sessions when lifecycle status proves the command
completed or failed cleanly.

Acceptance criteria:

- Completed/failed lifecycle status suppresses invalidation for ambiguous post-send transport
  errors when the runner remains reachable.
- Unknown status states still invalidate to preserve current safety.
- Diagnostics record why invalidation was skipped or retained.
- No command is replayed after an observed mutating `accepted`, `started`, `completed`, or `failed`
  state.

iOS simulator validation:

- Inject or simulate a lost response after a command completes.
- Verify status recovery prevents runner restart.
- Run the next command in the same session and verify it succeeds without re-launching xcodebuild.

### 5. Response retention tuning

Goal: retain enough small command results for useful recovery without making the runner retain large
snapshots or binary-like payloads.

Acceptance criteria:

- Small scalar responses can be recovered from `lifecycleResponseJson`.
- Snapshot node trees and screenshots are not serialized or retained in the journal.
- The journal memory cap remains bounded by entry count and response JSON size.
- Retention policy is documented in tests or runner fixtures so future commands do not accidentally
  store large payloads.

iOS simulator validation:

- Run small-result commands and verify status can recover retained JSON.
- Run snapshot-heavy commands and verify status reports terminal state without retained response JSON.
- Confirm the runner remains responsive after repeated snapshots.

## Suggested ordering

1. Land status-before-invalidate recovery first. It is the safety net needed before reducing
   defensive preflights.
2. Add diagnostics/metrics for preflight use, skipped preflights, status recovery, and invalidation
   reason. This can happen alongside slice 1 or 2.
3. Reduce `uptime` for hot interaction loops with a conservative command allowlist.
4. Make the status transport path observable during long-running commands.
5. Broaden the preflight policy only after simulator measurements show stable behavior.

## Side-by-side work

- Status recovery and diagnostics can be developed together or separately.
- Transport status visibility can proceed independently once the protocol is on `main`.
- Adaptive `uptime` should wait for status recovery, because it relies on the same recovery path for
  ambiguous post-send failures.
- Response retention tuning can proceed independently as long as it preserves the current caps.
