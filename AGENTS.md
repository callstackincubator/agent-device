# AGENTS.md

Minimal operating guide for AI coding agents in this repo.

## Objective

- Solve issues with the smallest context read.
- Keep changes scoped to one module family.
- Preserve daemon session semantics and platform behavior.

## Hard Rules

- Use `runCmd`/`runCmdSync` from `src/utils/exec.ts` for process execution.
- Use daemon session flow for interactions (`open` before interactions, `close` after).
- Do not remove shared snapshot/session model behavior without full migration.
- If Swift runner code changes, run `pnpm build:xcuitest`.

## Architecture In One Screen

1. CLI parse + formatting:
   - `src/bin.ts`
   - `src/cli.ts`
   - `src/utils/args.ts`
2. Daemon client transport:
   - `src/daemon-client.ts`
3. Daemon server bootstrap/router:
   - `src/daemon.ts`
4. Daemon command families:
   - session/apps/appstate/open/close/replay: `src/daemon/handlers/session.ts`
   - snapshot/wait/alert/settings: `src/daemon/handlers/snapshot.ts`
   - semantic find actions: `src/daemon/handlers/find.ts`
   - record/trace: `src/daemon/handlers/record-trace.ts`
5. Daemon shared domain:
   - session state + logs: `src/daemon/session-store.ts`
   - snapshot tree shaping + label resolution: `src/daemon/snapshot-processing.ts`
   - handler context helpers: `src/daemon/context.ts`, `src/daemon/device-ready.ts`, `src/daemon/app-state.ts`
6. Platform dispatch/backends:
   - dispatcher: `src/core/dispatch.ts`
   - capabilities: `src/core/capabilities.ts`
   - iOS: `src/platforms/ios/*`, `ios-runner/*`
   - Android: `src/platforms/android/*`

## First-Read Protocol (Strict)

1. Identify command family from failing behavior.
2. Read at most 3 files first:
   - the owning handler/module
   - one shared helper used by that handler
   - one downstream platform file if needed
3. Expand only when contract crosses module boundaries.

Do not read both iOS and Android paths unless issue is explicitly cross-platform.

## Command Family Ownership

- `session list`, `devices`, `apps`, `appstate`, `open`, `close`, `replay`:
  - `src/daemon/handlers/session.ts`
- `snapshot`, `wait`, `alert`, `settings`:
  - `src/daemon/handlers/snapshot.ts`
- `find ...`:
  - `src/daemon/handlers/find.ts`
- `record start|stop`, `trace start|stop`:
  - `src/daemon/handlers/record-trace.ts`
- `click`, `fill`, `get`, generic passthrough:
  - `src/daemon.ts` (remaining fallback logic)

## Capability Source Of Truth

- Command/device support must come from `src/core/capabilities.ts`.
- Do not scatter new support checks across handlers.

## Testing Strategy

### Test placement policy

- Unit tests are colocated with source files under `src/**`.
- Use `__tests__` folders colocated with the related source folder.
- The `test/**` tree is integration-only (including smoke integration tests).

### Unit tests (default for all refactors, colocated)

- `src/core/__tests__/capabilities.test.ts`
- `src/daemon/handlers/__tests__/find.test.ts`
- `src/daemon/__tests__/snapshot-processing.test.ts`
- `src/daemon/__tests__/session-store.test.ts`

Add/extend colocated unit tests in the same PR for touched module logic.

### Verification matrix

- Any TS change:
  - `pnpm typecheck`
- Daemon handler/shared module change:
  - `pnpm test:unit`
  - `pnpm test:smoke`
- iOS runner/Swift change:
  - `pnpm build:xcuitest`

Run integration tests when behavior crosses platform boundaries:
- `pnpm test:integration`

## Productivity Measurement

- Use `docs/daemon-refactor-impact.md`.
- Track:
  - files touched per fix
  - cycle time
  - iOS/Android regressions

## Local Commands

- Run CLI: `pnpm ad <command>`
- Typecheck: `pnpm typecheck`
- Unit tests: `pnpm test:unit`
- Smoke tests: `pnpm test:smoke`
- Integration tests: `pnpm test:integration`
