# ADR 0004: iOS Snapshot Backend Strategy

## Status

Accepted — implemented by the snapshot capture plan runner (RunnerTests+SnapshotCapturePlan.swift):
each strategy declares its backend chain, and a structured snapshot quality verdict makes
degraded or recovered output observable end to end.

## Context

Agent Device exposes iOS UI state through snapshots produced by the long-lived XCTest runner. The
runner has three different snapshot needs:

- agent-facing regular context, where the important contract is the effective user-visible UI,
  fixed controls such as tab bars, and scroll-hidden hints for content outside visible scroll
  containers;
- rich diagnostics and selector disambiguation, where a raw recursive XCTest snapshot is useful
  because it preserves hierarchy, static text, wrappers, scroll containers, and ancestry;
- agent-facing compact interactive context, where the important contract is fast, bounded discovery
  of visible controls and stable refs for the next action.

These needs should not share one capture strategy blindly. Recursive `XCUIElement.snapshot()` is
rich, but some real simulator app trees can make XCTest fail with `kAXErrorIllegalArgument` while
the same app remains visually usable and can be inspected by lower-level simulator accessibility
services. Bluesky is the current known example: Argent's `ax-service` can describe the screen, but
XCTest recursive snapshots and typed `XCUIElementQuery` enumeration can degrade to no useful child
nodes.

This is different from presentation filtering. The daemon's snapshot presentation can hide noisy
or inaccessible nodes, but it cannot recover nodes that XCTest never returns. More filters,
Maestro-specific heuristics, or retries in the daemon would only make this failure slower and less
predictable.

## Decision

Keep XCTest as the default iOS automation runner and split iOS snapshot capture into explicit
strategies:

- **Regular visible strategy**: use recursive XCTest snapshots, but emit only the effective
  user-visible tree plus visible ancestors and scroll-hidden hints. A node inside a scroll
  container is user-visible only when it intersects both the app viewport and the nearest visible
  scroll container. Offscreen descendants should be visited to set `hiddenContentAbove` /
  `hiddenContentBelow`, not emitted as normal visible nodes. This strategy must not use an
  arbitrary node-count cutoff: fixed controls that are later in traversal order, such as bottom tab
  bars after long lists, are part of the visible UI contract.
- **Raw diagnostic strategy**: use recursive XCTest snapshots for raw snapshots, diagnostics, and
  cases that need hierarchy. Raw output is allowed to be noisy and large; if the transport cannot
  carry the response, fail explicitly instead of silently truncating the tree at a hard node count.
  If XCTest reports a real AX serialization failure, preserve that error instead of pretending the
  UI is empty.
- **Compact interactive strategy**: for `snapshot -i -c`, use a bounded flat XCTest query strategy
  that avoids recursive root snapshots and app/window property reads. It should prefer fast,
  one-screen actionability over hierarchy fidelity and should return a sparse root quickly when
  XCTest cannot enumerate controls. Its bound is time-based, not a hidden fixed node budget.
- **Future simulator AX-service strategy**: treat Bluesky-class failures as evidence that XCTest is
  not a complete semantic snapshot backend. A robust semantic fix should add a host-side simulator
  accessibility backend, similar in role to `idb` accessibility commands or Argent's `ax-service`,
  and normalize its output into the same `SnapshotNode` model. That backend can be simulator-only;
  physical devices can continue using XCTest unless a supported lower-level API exists.

The daemon should make degraded compact output observable. If an iOS compact interactive snapshot
contains only the synthetic application root, surface a warning so agents know the snapshot is
bounded fallback output rather than proof that the screen has no controls.

## Regression Notes

PR #639 made XCTest AX serialization failures explicit instead of swallowing them as empty
snapshots. That was the correct diagnostic change, but it exposed apps whose accessibility trees
XCTest cannot serialize.

The first compact fallback then still paid several XCTest reads (`app.label`, `app.identifier`,
`app.frame`, window frame lookup) before enumerating flat controls. On broken trees those reads can
hit the same AX failure path, which made `snapshot -i -c` much slower than the plain snapshot in
some apps. PR #700 changed compact interactive snapshots to enter the flat strategy immediately and
avoid those app/window reads.

## Consequences

Compact interactive snapshots are allowed to be less complete than regular or raw snapshots, but
they must be bounded and honest. They should never block for the full daemon snapshot timeout
because one app has a pathological AX tree.

Regular snapshots remain the right tool for agents and Maestro compatibility because they describe
what a user can currently perceive and interact with. Raw snapshots remain the right tool when
hierarchy matters. Both may still fail loudly on XCTest-broken trees; that failure is useful because
retrying the same recursive capture is unlikely to reveal a different tree.

A future AX-service backend is the correct place to regain Bluesky-class semantic coverage. It
should be added as a platform backend with its own lifecycle, protocol, normalization, timing
metrics, and fallback rules, not as another special case inside the XCTest runner.

When adding new iOS snapshot behavior, maintainers should first decide which strategy owns it. If a
change tries to make compact snapshots rich by reintroducing recursive snapshots, tries to make
regular snapshots fast by dropping visible controls behind a node budget, or tries to make raw
snapshots safe by silently truncating, it is probably crossing strategy boundaries.
