# Agent Device Tester

`Agent Device Tester` is a minimal Expo Router fixture app for `agent-device` and `skillgym` experiments.

It is intentionally small, but each surface is dense with durable accessibility targets so a few screens cover a large share of the workflows we care about.

## Why this app exists

- It gives `agent-device` a stable React Native target that we control.
- It makes `skillgym` prompts concrete: the agent can inspect real app files instead of answering against an imagined UI.
- It keeps the number of screens low while still covering roughly 50 practical interaction and verification cases.

## Screens

- `Home`: visible-text checks, dismissible banner, modal open/close, async loading, status badge, switch state
- `Catalog`: search debounce, filter chips, long-list scroll, favorite toggles, cart updates, drill-in navigation
- `Product detail`: back navigation, quantity stepper, multiline notes, save action
- `Checkout form`: required-field validation, fill vs type, checkbox state, choice groups, keyboard dismiss, success summary
- `Settings`: switch rows, accordion content, loading and error states, retry flow, destructive-confirm modal

Navigation uses Expo Router native bottom tabs, so the tab bar itself is also part of the test surface.

## Coverage map

These are the main case families this app can support without adding more screens:

- app open and close
- visible text verification with plain `snapshot`
- interactive discovery with `snapshot -i`
- `press` on stable buttons, pills, and rows
- `fill` on single-line and multiline fields
- `type` after focus for append flows
- `get text` on headings, badges, summaries, and accordion content
- `is visible` and `is exists` assertions
- `wait` for async loading and success states
- `diff snapshot` after dismissals and submits
- long-list scrolling and `scrollintoview`
- selector-based navigation across repeated cards
- modal open, cancel, and confirm flows
- switch and checkbox state changes
- validation-error and recovery loops
- retryable error banners
- cart counters and quantity changes
- screenshot and recording proof capture

## Run locally

From the repo root:

```bash
pnpm test-app:install
pnpm test-app:ios
```

Or on Android:

```bash
pnpm test-app:install
pnpm test-app:android
```

If you prefer to work from inside the app folder:

```bash
cd examples/test-app
pnpm install --ignore-workspace
pnpm ios
```

Or on Android:

```bash
cd examples/test-app
pnpm install --ignore-workspace
pnpm android
```

Once the app is running, use `agent-device` against `Agent Device Tester` like any other target app.

## Local Agent Device suites

The repo includes two local suites for iterating on the fixture app:

```bash
pnpm test-app:replay:ios
pnpm test-app:replay:android
```

These run the `.ad` replay suite in `examples/test-app/replays`.

To target a specific iOS simulator or an installed Expo development build, run the
underlying command directly so global flags stay before replay inputs:

```bash
node bin/agent-device.mjs test examples/test-app/replays \
  --platform ios \
  --device "iPhone 17 Pro" \
  --env APP_TARGET=dev.expo.easagentdevice \
  --env APP_URL=<project-url> \
  --artifacts-dir .tmp/test-app-replay/ios
```

Use `APP_TARGET=com.callstack.agentdevicelab` when the standalone fixture app is
installed instead of an Expo development shell.

The Maestro prototype suite lives in `examples/test-app/maestro` and runs through
`agent-device replay --maestro`:

```bash
pnpm test-app:maestro:ios -- --open "Agent Device Tester"
pnpm test-app:maestro:android -- --open "Agent Device Tester"
```

When running through Expo Go, start the project first and pass the shell that is already showing
the app, for example:

```bash
pnpm test-app:maestro:ios -- --open "Expo Go"
```

The suite intentionally covers the compat layer syntax used by public Maestro suites:
`runFlow` file/inline blocks, `when.platform`, config hooks, deterministic `repeat.times`,
flow `env`, selectors, input, assertions, and swipe.
