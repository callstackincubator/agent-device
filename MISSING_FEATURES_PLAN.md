# Missing Features Plan

This plan reflects current status after the AX/XCTest refactors and P0 parity work.

## P1 (debug and reliability)

- Trace/log capture toggle for XCTest/AX (extend daemon logging feature).
- Retry strategy knobs (backoff, max retries) for flaky operations.
- Hybrid snapshot backend: AX for speed, XCTest fill for empty tab bars/toolbars/groups (via `--backend hybrid`).

## P2 (advanced parity)

- Semantic finders (find text/label/value/role) to avoid raw refs.
- App state: foreground app, current activity, app list with metadata.
- OS settings helpers (toggle wifi, location, airplane mode) for simulators.

## P3 (nice-to-have)

- Highlight ref (visual debug overlay for refs).
- Multi-screen/multi-window support (iPad, Android multi-window).
- UI caching (reuse snapshot nodes across steps with validation).
- Screenshot OCR helpers for visual-only flows.
