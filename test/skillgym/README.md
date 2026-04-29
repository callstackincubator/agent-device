# Skillgym For agent-device

This folder is a starter `skillgym` setup for benchmarking the `agent-device` skill with a controlled Expo target app.

## Why `skillgym` fits here

`skillgym` is useful for `agent-device` in three layers:

1. Skill-routing checks: verify that the runner loads `skills/agent-device/SKILL.md` and its required references before it answers.
2. Workflow-planning checks: verify that the agent describes the right `agent-device` loop for a known fixture app.
3. Optional live-device smoke runs: locally, you can extend prompts so the agent actually drives `agent-device` against a simulator or device.

The included suite focuses on the first two layers so it stays stable and CI-safe.
The suite uses SkillGym v0.6 case tags:

- `fixture-smoke`: fixture-specific app surface coverage
- `skill-guidance`: command-planning guidance regressions

## Included files

- `../../examples/test-app/`: minimal Expo SDK 55 fixture app for broad UI coverage
- `skillgym.config.ts`: starter config that runs Codex and Claude Haiku against this repo
- `suites/agent-device-smoke-suite.ts`: planning suite for skill routing, fixture-aware flows, and skill-guidance regressions

## Current coverage

The suite keeps the app small while separating coverage into two non-overlapping groups.

Fixture smoke cases cover concrete app surfaces:

- open/snapshot/close defaults with Expo Go
- banners, alerts, toggles, and quick actions on Home
- search debounce, filters, long-list scroll, favorites, and cart updates in Catalog
- detail navigation, quantity edits, note append, and save-to-cart on Product
- form validation, success submit, iOS keyboard-dismiss fallback, and reset on Checkout form
- diagnostics load/error/retry plus reset alert handling in Settings
- accessibility audit via screenshot + snapshot

Skill-guidance regression cases cover distinct command-planning habits:

- read-only inspection versus mutation
- fresh `@ref` targeting, durable selectors, raw-rect fallbacks, and off-screen scroll recovery
- text replacement, append semantics, supported field clearing, keyboard status, and keyboard fallback
- install/open setup, Expo Go host-shell launch, app discovery, session scoping, and app-owned navigation fallbacks
- Metro reload, logs, network dump, alert fallback, and screenshot evidence
- performance metrics, React DevTools profiling, gestures, settings, and trace capture
- remote config, macOS menu bar surfaces, replay update, same-session mutation ordering, and batch schema/recording

`assertAgentDeviceEvidence` is intentionally soft when a runner does not expose skill-detection telemetry. When telemetry exists, the suite asserts that `agent-device` was loaded; when it is absent, the cases still judge command-planning output instead of failing on missing runner metadata.

The `codex-mini` baseline is a benchmark signal, not a required all-green gate. Its failures should map to command-planning regressions called out by individual case IDs; do not treat the historical pass/fail count as a fixed threshold.

SkillGym v0.6 structured command matchers are for shell commands the agent actually executed. This suite primarily validates the command plan in the final answer, so it keeps line-anchored final-output matchers for planned `agent-device` commands.

## Suggested workflow

1. Start with the included smoke suite to benchmark routing and default guidance.
2. Extend the suite with app-specific prompts that cover a new command-planning category rather than duplicating an existing one.
3. Add local-only cases that expect real `agent-device` shell commands once you are ready to involve a running simulator.

## Running the suite

`skillgym` is installed as a repo dev dependency, so run the starter suite from the project root:

```bash
cd /absolute/path/to/agent-device
pnpm install
pnpm test:skillgym
```

If you want to run `skillgym` directly instead of using the convenience script, build the local CLI first so agents can call `node bin/agent-device.mjs help workflow`:

```bash
cd /absolute/path/to/agent-device
pnpm build
pnpm exec skillgym run \
  ./test/skillgym/suites/agent-device-smoke-suite.ts \
  --config ./test/skillgym/skillgym.config.ts
```

Useful v0.6 filters and reporters:

```bash
pnpm build
pnpm exec skillgym run \
  ./test/skillgym/suites/agent-device-smoke-suite.ts \
  --config ./test/skillgym/skillgym.config.ts \
  --tag fixture-smoke

pnpm exec skillgym run \
  ./test/skillgym/suites/agent-device-smoke-suite.ts \
  --config ./test/skillgym/skillgym.config.ts \
  --reporter json
```

Use `--reporter github-actions` in CI when you want annotations in GitHub Actions logs.

The config uses `schedule: isolated-by-runner` with `maxParallel: 8`. That keeps each runner serial while allowing configured runners to overlap, and caps future runner additions to the expected local machine capacity instead of using all available host parallelism by default. Override with `--max-parallel <n>` for local experiments.

Prerequisites:

- `codex` CLI installed and authenticated, because the starter config uses the Codex runner
- `claude` CLI installed and authenticated, because the same cases also run against Claude Haiku
- repo dependencies installed with `pnpm install`
- if you want the fixture app running locally, use `pnpm test-app:install` and then `pnpm test-app:ios` or `pnpm test-app:android`

## Where to extend next

- Add suite cases that ask for selector-based plans against `Agent Device Tester`.
- Add local-only prompts that expect `agent-device open`, `snapshot`, `snapshot -i`, `get`, and `wait`.
- Add regression snapshots once the prompt set stabilizes.
