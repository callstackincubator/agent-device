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
