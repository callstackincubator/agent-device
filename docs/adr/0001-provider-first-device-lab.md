# ADR 0001: Provider-First Device Lab

## Status

Accepted

## Context

The test suite had many mocked daemon handler and dispatch unit tests. Those tests were expensive to maintain and skipped important behavior across request admission, locking, session state, handler routing, dispatch, Interactor resolution, and platform module command translation.

Android already had an ADB provider seam. Apple-family and Linux platform modules mostly called host tools or runner commands directly, which made device-free integration tests difficult without mocking too high in the stack.

## Decision

Keep `Interactor` as the semantic interface between dispatch and platform behavior.

Add request-scoped provider seams below platform modules:

- Android ADB provider
- Apple tool provider
- Apple runner provider
- Linux tool provider

Device Lab tests run the real daemon request path and replace only those providers. Tests may use provider transcripts for exact platform command contracts and scenario transcripts for broader user workflows.

## Consequences

Platform command translation remains covered by integration tests without requiring real devices.

The request router owns a provider registry seam, but platform-specific provider applicability remains localized in that registry.

New remote or cloud-backed adapters can implement neutral provider contracts without changing daemon, dispatch, or session contracts.

Mock-heavy handler unit tests should be deleted only after equivalent Device Lab scenario coverage exists. Unit tests remain appropriate for pure logic, parser matrices, selector matching, capability maps, and edge/error cases that integration tests would express poorly.
