# Provider-First Architecture Roadmap

This tracks the remaining architecture work after ADR 0001. The aim is to keep the Provider-first Device Lab architecture deep: broad command workflows should run through the real daemon path, Provider seams should stay below Platform modules, and unit tests should remain focused on parser, state-machine, selector, capability, and error behavior.

`ensure-simulator` removal is intentionally excluded here because it is happening in a parallel stream.

## Milestones

| # | Milestone | Status | Done means |
| ---: | --- | --- | --- |
| 1 | macOS helper permission and alert coverage | Done | Device Lab covers helper-backed permission grant/reset and alert get/accept/dismiss through the daemon request path. Redundant mocked happy-path units are removed when they no longer protect edge behavior. |
| 2 | Device Lab scenario world modules | Done | Repeated scripted device worlds move behind small test modules so scenarios read as workflows, not fixture construction. |
| 3 | Recording lifecycle locality | Done | Record/trace start-stop success paths are owned by Device Lab; unit tests focus on lifecycle edge cases, cleanup, telemetry, overlay, and fallback state machines. |
| 4 | Provider registry applicability | Done | Adding a Provider requires localized registration of applicability, resolution, and scope application instead of edits across several parallel type/function lists. |
| 5 | Apple tool semantic pressure | Tracked | Generic Apple tool scripting is reduced only where Device Lab or a second Adapter proves a stable semantic Provider operation. |
| 6 | Snapshot unit-test split and deletion | Started | Snapshot handler unit tests are grouped by retained reason, and broad success paths covered by Device Lab are deleted. |
| 7 | Progress metrics quality dimensions | Done | Progress reporting includes command-family ownership, mock-heavy handler tests by family, and raw Provider transcript usage by platform. |

## Current Assessment

- Provider placement remains sound: Device Lab replaces platform Providers below handlers and dispatch, so request admission, locking, session state, command routing, platform translation, and provider contracts stay under test.
- Scenario worlds are useful when they remove fixture noise from workflow tests. They should stay thin and platform-specific; they must not become an alternate framework above the daemon request path.
- Apple raw tool/helper pressure is visible but not yet a mandate for more semantic sub-providers. The macOS helper calls are still one host-helper contract, while iOS simulator/device operations already have semantic `simctl` and `devicectl` runners.
- Snapshot unit deletion should remain conservative. The first safe deletion was a macOS alert happy path now covered by Device Lab. The remaining snapshot units mostly protect freshness, scoped refs, menubar targeting, retry behavior, and snapshot shaping.

## Operating Rules

- Use Device Lab for command workflows and Provider contracts.
- Keep HTTP contract tests narrow and transport-specific.
- Keep unit tests for pure logic, parser matrices, selector matching, capabilities, state machines, malformed inputs, and cleanup/error behavior.
- Promote semantic Provider operations only when the current generic Provider interface forces tests or Adapters to recover intent from raw host commands.
- After each milestone, do a zoom-out self-review before moving to the next one.
