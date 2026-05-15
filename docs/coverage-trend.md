# Coverage Trend

Coverage is a trend signal for the Device Lab migration, not proof that the command surface is well tested.

Use `pnpm test:coverage:check` when evaluating broad test-suite changes. The command runs Vitest coverage for `src` plus `test/integration/device-lab`, writes `coverage/coverage-summary.json`, and checks the aggregate result with `scripts/check-coverage-trend.mjs`.

CI runs the same command as the `Coverage Trend` job. When running in GitHub Actions, the checker writes the current statement, line, branch, and function percentages to the job summary.

## Current Gates

- Statement target: 80%.
- Statement regression floor: 78%.
- Line regression floor: 80%.

The checker fails below the floors. It warns below the statement target so the PR can continue while the suite is still climbing toward the near-term 80-82% statement range with valuable integration tests.

Raise floors only after the command coverage matrix shows the added coverage is meaningful. Do not raise floors by adding tests that execute code without asserting user-visible behavior, provider contracts, parser contracts, or important edge/error handling.

## What Counts

Valuable coverage includes:

- Device Lab scenarios that run through request admission, session state, handlers, dispatch, platform modules, and provider seams.
- Unit tests for parsers, selectors, capability maps, snapshot processing, platform parsers, and edge/error behavior.
- Focused provider translation tests when a local provider maps semantic intent to host tools.

Low-value coverage includes:

- Handler tests that mock dispatch/platform modules just to repeat a happy path already covered by Device Lab.
- Assertions that only restate an implementation call list when user-visible behavior or a provider contract would be enough.
- Tests added only to increase percentages without protecting a real contract.
