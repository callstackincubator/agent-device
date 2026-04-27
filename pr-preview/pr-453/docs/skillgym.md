# Skillgym

`agent-device` works well with [`skillgym`](https://github.com/callstackincubator/skillgym) when you want to benchmark skill routing and workflow quality before paying the cost of full live-device runs.

## What `skillgym` gives us

- repeatable agent sessions against the real repo
- assertions on detected skills, file reads, tool calls, commands, and final output
- artifact capture and token regression snapshots

For `agent-device`, that makes it a strong fit for:

- verifying that the `agent-device` skill is selected for simulator and device tasks
- verifying that the skill loads its mandatory references before normal interactions
- checking that planning guidance mentions the right `agent-device` loop for a known fixture app

## Included starter

This repo now includes a starter setup under `test/skillgym` plus a fixture app under `examples/test-app`:

- `examples/test-app`: a minimal Expo fixture app
- `test/skillgym/skillgym.config.ts`: starter config
- `test/skillgym/suites/agent-device-smoke-suite.ts`: CI-safe smoke suite

## Recommended rollout

1. Start with skill-routing suites that assert `agent-device` is loaded in the right prompts.
2. Add fixture-aware planning suites against `Agent Device Tester` to keep prompts concrete.
3. Add local-only cases that expect real `agent-device` command usage when a simulator or device is available.

## Fixture app coverage

`Agent Device Tester` keeps the screen count low while still covering a wide range of cases:

- visible-text verification
- interactive refs and selector targeting
- form fill and multiline notes
- search debounce and filter chips
- long-list scroll and detail drill-in
- modals, toggles, checkboxes, validation errors, and retryable async states

The default suite now covers 48 cases in two MECE groups.

Fixture smoke cases cover concrete app behavior:

- Expo Go open/snapshot/close
- Home banner dismissal, confirmation alerts, and refresh waits
- Catalog search debounce, category filters, favorites, add-to-cart, and scroll
- Product detail navigation, quantity edits, note append, and save-to-cart
- Form validation errors, successful submit, keyboard dismiss, and reset
- Settings diagnostics error/retry, preference toggles, and reset alert handling
- Accessibility audit (screenshot vs snapshot)

Skill-guidance regression cases cover command-planning habits:

- read-only inspection versus mutation
- fresh `@ref` targeting, durable selectors, and off-screen scroll recovery
- text replacement, append semantics, keyboard status, and keyboard dismiss
- install/open setup, app discovery, session scoping, and in-app back navigation
- Metro reload, logs, network dump, alert fallback, and screenshot evidence
- performance metrics, React DevTools profiling, gestures, settings, and trace capture
- remote config, macOS menu bar surfaces, replay update, and batch during recording

Runner skill telemetry is treated as optional. When a runner reports detected skills, the suite asserts that `agent-device` was selected; otherwise the suite still evaluates the final command plan.

## Run it

`skillgym` is installed as a repo dev dependency. From the repo root:

```bash
cd /absolute/path/to/agent-device
pnpm install
pnpm test:skillgym
```

Equivalent direct command:

```bash
pnpm exec skillgym run \
  ./test/skillgym/suites/agent-device-smoke-suite.ts \
  --config ./test/skillgym/skillgym.config.ts
```
