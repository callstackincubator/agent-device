# Runtime Command Stability

The runtime command API is the stable command-semantics boundary for hosted
adapters, daemon compatibility shims, and direct Node integrations.

## Versioning rules

- New runtime commands are added under typed namespaces such as `capture`,
  `selectors`, `interactions`, and `apps`.
- Public command methods are exposed only after their backend primitive,
  JavaScript result shape, router dispatch, and conformance coverage are in
  place.
- Result unions stay discriminated with a `kind` field. Additive fields are
  allowed in minor releases; removing or changing existing fields requires a
  major release or a documented migration window.
- Command options should keep `session`, `requestId`, `signal`, and `metadata`
  from `CommandContext` so hosted transports can preserve cancellation and
  audit scope.
- Backend primitives remain small named methods. Do not add generic
  `run(command, args)` escape hatches for portable command behavior.
- File input, file output, named backend capabilities, and local path access
  must stay policy-gated.

## Deprecation rules

- Planned commands belong in `commandCatalog` until they are implemented.
- Compatibility helper subpaths remain available during the migration, but new
  command semantics should move behind `agent-device/commands`,
  `agent-device/backend`, and `agent-device/io`.
- Helpers should not be hard-deprecated until downstream hosted adapters have
  moved to runtime command APIs or `createCommandRouter()`.
- Deprecations must identify the replacement runtime namespace and the first
  package version where the replacement is available.

## Transport boundary

Use `createCommandRouter()` for hosted or RPC transports. The router should be
the boundary that:

- constructs a request-scoped runtime,
- applies per-command policy before dispatch,
- normalizes command errors,
- preserves per-request context, and
- avoids exposing daemon-only session or platform internals.

Direct service integrations can call `createAgentDevice()` when they already
own backend, artifact, session, and policy objects in-process.
