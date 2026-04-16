# Command Ownership Inventory

This inventory keeps the public boundary stable while command semantics move into
the runtime layer. New integrations should prefer the runtime, backend, and IO
interfaces over helper subpaths.

## Portable Command Runtime

These commands describe device, app, capture, selector, or interaction behavior.
Their semantics should live in `agent-device/commands` as they migrate.

- `alert`
- `app-switcher`
- `apps`
- `appstate`
- `back`
- `click`
- `clipboard`
- `close`
- `diff`
- `fill`
- `find`
- `focus`
- `get`
- `home`
- `is`
- `keyboard`
- `longpress`
- `open`
- `pinch`
- `press`
- `push`
- `rotate`
- `screenshot`
- `scroll`
- `settings`
- `snapshot`
- `swipe`
- `trigger-app-event`
- `type`
- `wait`

## Runtime Migration Status

- `screenshot`: runtime command implemented; daemon screenshot dispatch calls the runtime.
- `diff screenshot`: runtime command implemented; CLI screenshot diff dispatch calls the runtime.
- `snapshot`: runtime command implemented; daemon snapshot dispatch calls the runtime.
- `diff snapshot`: runtime command implemented; daemon snapshot diff dispatch calls the runtime.
- `find`: read-only runtime actions implemented for `exists`, `wait`, `get text`,
  and `get attrs`; mutating find actions remain on the existing interaction path.
- `get`: runtime command implemented; daemon get dispatch calls the runtime.
- `is`: runtime command implemented; daemon is dispatch calls the runtime.
- `wait`: runtime command implemented for sleep, text, ref, and selector waits;
  daemon wait dispatch calls the runtime.
- `click`: runtime command implemented for point, ref, and selector targets; the
  daemon click dispatch calls the runtime.
- `press`: runtime command implemented for point, ref, and selector targets; the
  daemon press dispatch calls the runtime.
- `fill`: runtime command implemented for point, ref, and selector targets; the
  daemon fill dispatch calls the runtime.
- `type`: runtime command implemented; daemon type dispatch calls the runtime.
- `open`: runtime `apps.open` implemented for typed app, bundle/package,
  activity, URL, and relaunch targets.
- `close`: runtime `apps.close` implemented for optional app targets.
- `apps`: runtime `apps.list` implemented with typed app list filters.
- `appstate`: runtime `apps.state` implemented against backend state
  primitives.
- `push`: runtime `apps.push` implemented with JSON and artifact/file inputs;
  local file inputs remain command-policy gated.
- `trigger-app-event`: runtime `apps.triggerEvent` implemented with event name
  and JSON payload validation.
- `back`: runtime `system.back` implemented with typed in-app/system modes.
- `home`: runtime `system.home` implemented.
- `rotate`: runtime `system.rotate` implemented with explicit orientation
  validation.
- `keyboard`: runtime `system.keyboard` implemented with explicit status/get
  and dismiss result shapes.
- `clipboard`: runtime `system.clipboard` implemented with read/write result
  unions.
- `settings`: runtime `system.settings` implemented as a typed settings-open
  primitive.
- `alert`: runtime `system.alert` implemented with explicit status, handled,
  and wait result unions.
- `app-switcher`: runtime `system.appSwitcher` implemented.
- `focus`: runtime `interactions.focus` implemented for point, ref, and
  selector targets.
- `longpress`: runtime `interactions.longPress` implemented for point, ref, and
  selector targets.
- `swipe`: runtime `interactions.swipe` implemented with point, ref, selector,
  and viewport-derived directional starts.
- `scroll`: runtime `interactions.scroll` implemented with viewport, point, ref,
  and selector targets.
- `pinch`: runtime `interactions.pinch` implemented behind the typed backend
  primitive.

## Boundary Requirements

- Public command APIs expose only implemented commands. Planned commands belong
  in `commandCatalog`, not as methods that throw at runtime.
- Runtime services default to `restrictedCommandPolicy()`. Local input and
  output paths require an explicit local policy or adapter decision.
- File inputs and outputs cross the runtime boundary through `agent-device/io`
  refs and artifact descriptors; command implementations should not accept
  ad-hoc path strings for new file contracts.
- Image-producing or image-reading commands must preserve `maxImagePixels`
  enforcement before decoding or comparing untrusted images.
- Backend escape hatches must be named capabilities with a policy gate. Do not
  add a freeform backend command bag.
- Command options should carry `session`, `requestId`, `signal`, and `metadata`
  through `CommandContext` so hosted adapters can enforce request scope,
  cancellation, and audit correlation consistently.
- Runtime command modules should depend on shared `src/utils/*` helpers, not
  daemon-only modules. Keep daemon paths as compatibility shims when older
  handlers still import them.
- New backend adapters should run `agent-device/testing/conformance` suites for
  the command families they claim to support.

## Backend And Admin Capabilities

These commands manage devices or app installation. Keep them explicit backend
capabilities so hosted adapters can decide what is supported.

- `boot`
- `devices`
- `ensure-simulator`
- `install`
- `install-from-source`
- `reinstall`

## Transport And Session Orchestration

These are daemon, CLI, or transport concerns. They can construct or call the
runtime, but they are not portable command semantics.

- `session`
- lease allocation, heartbeat, and release daemon commands

## Environment Preparation

These prepare local or remote development environment state. Keep them outside
the portable command runtime.

- `connect`
- `connection`
- `disconnect`
- `metro`

## Later Capability-Gated Runtime Commands

These commands should migrate only after the runtime, backend capability, and IO
contracts are established for their behavior.

- `batch`
- `logs`
- `network`
- `perf`
- `record`
- `replay`
- `test`
- `trace`

## Compatibility Helper Subpaths

These subpaths remain available during migration, but they should not be the
primary boundary for new command behavior:

- `agent-device/contracts`
- `agent-device/selectors`
- `agent-device/finders`
- `agent-device/install-source`
- `agent-device/android-apps`
- `agent-device/artifacts`
- `agent-device/metro`
- `agent-device/remote-config`
