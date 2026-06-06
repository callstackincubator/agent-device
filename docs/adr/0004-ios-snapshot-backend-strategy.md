# ADR 0004: iOS Snapshot Backend Strategy

## Status

Accepted

## Context

Agent Device exposes iOS UI state through snapshots produced by the long-lived XCTest runner. The
runner has two different snapshot needs:

- rich diagnostics and selector disambiguation, where a recursive XCTest snapshot is useful because
  it preserves hierarchy, static text, wrappers, scroll containers, and ancestry;
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

- **Full tree strategy**: use recursive XCTest snapshots for normal/full snapshots, raw snapshots,
  diagnostics, and cases that need hierarchy. If XCTest reports a real AX serialization failure,
  preserve that error instead of pretending the UI is empty.
- **Compact interactive strategy**: for `snapshot -i -c`, use a bounded flat XCTest query strategy
  that avoids recursive root snapshots and app/window property reads. It should prefer fast,
  one-screen actionability over hierarchy fidelity and should return a sparse root quickly when
  XCTest cannot enumerate controls.
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

Compact interactive snapshots are allowed to be less complete than full snapshots, but they must be
bounded and honest. They should never block for the full daemon snapshot timeout because one app has
a pathological AX tree.

Full snapshots remain the right tool when hierarchy matters. They may still fail loudly on
XCTest-broken trees; that failure is useful because retrying the same recursive capture is unlikely
to reveal a different tree.

A future AX-service backend is the correct place to regain Bluesky-class semantic coverage. It
should be added as a platform backend with its own lifecycle, protocol, normalization, timing
metrics, and fallback rules, not as another special case inside the XCTest runner.

When adding new iOS snapshot behavior, maintainers should first decide which strategy owns it. If a
change tries to make compact snapshots rich by reintroducing recursive snapshots, or tries to make
full snapshots fast by hiding XCTest failures, it is probably crossing strategy boundaries.
