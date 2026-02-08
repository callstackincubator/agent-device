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
- Do not add command logic to `daemon.ts` — it is a thin router. Use handler modules.
- Use `inferFillText` and `uniqueStrings` from `src/daemon/action-utils.ts`. Do not duplicate.
- Use `evaluateIsPredicate` from `src/daemon/is-predicates.ts` for assertion logic. Do not inline.

## Architecture In One Screen

1. CLI parse + formatting:
   - `src/bin.ts`
   - `src/cli.ts`
   - `src/utils/args.ts`
2. Daemon client transport:
   - `src/daemon-client.ts`
3. Daemon server bootstrap/router:
   - `src/daemon.ts` — thin router only, delegates to handler modules
4. Daemon command families:
   - session/apps/appstate/open/close/replay: `src/daemon/handlers/session.ts`
   - click/fill/get/is: `src/daemon/handlers/interaction.ts`
   - snapshot/wait/alert/settings: `src/daemon/handlers/snapshot.ts`
   - semantic find actions: `src/daemon/handlers/find.ts`
   - record/trace: `src/daemon/handlers/record-trace.ts`
5. Daemon shared domain:
   - session state + logs: `src/daemon/session-store.ts`
   - selector DSL (parse, resolve, build): `src/daemon/selectors.ts`
   - `is` predicate evaluation: `src/daemon/is-predicates.ts`
   - shared action helpers (inferFillText, uniqueStrings): `src/daemon/action-utils.ts`
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
- `click`, `fill`, `get`, `is`:
  - `src/daemon/handlers/interaction.ts`
- `snapshot`, `wait`, `alert`, `settings`:
  - `src/daemon/handlers/snapshot.ts`
- `find ...`:
  - `src/daemon/handlers/find.ts`
- `record start|stop`, `trace start|stop`:
  - `src/daemon/handlers/record-trace.ts`
- Generic passthrough (press, scroll, type, etc.):
  - `src/daemon.ts` (fallback after all handlers return null)

## Capability Source Of Truth

- Command/device support must come from `src/core/capabilities.ts`.
- Do not scatter new support checks across handlers.

## Selector System Rules

All interaction commands (`click`, `fill`, `get`, `is`) and `wait` accept selectors in addition to `@ref`.
The selector pipeline is: **parse → resolve → act → record selectorChain → heal on replay**.

- Selector DSL lives in `src/daemon/selectors.ts`. Do not duplicate parsing/matching logic elsewhere.
- `buildSelectorChainForNode` generates fallback chains stored in action results. Always call it after resolving a node for an interaction — it powers replay healing.
- When adding a new interaction command that targets a UI element: support both `@ref` and selector input, record `selectorChain`, and update replay healing (`healReplayAction` + `collectReplaySelectorCandidates` in `session.ts`).
- When adding a new selector key: update `SelectorKey` type, `ALL_KEYS`/`TEXT_KEYS`/`BOOLEAN_KEYS` sets, `matchesTerm`, and `isSelectorToken` — all in `selectors.ts`.
- When adding a new `is` predicate: update `IsPredicate` type and `evaluateIsPredicate` in `is-predicates.ts`, not in the handler.
- `daemon.ts` must stay a thin router. Do not add command logic there — use the appropriate handler module.

## Testing Strategy

### Test placement policy

- Unit tests are colocated with source files under `src/**`.
- Use `__tests__` folders colocated with the related source folder.
- The `test/**` tree is integration-only (including smoke integration tests).
- Example: tests for `src/daemon/selectors.ts` go in `src/daemon/__tests__/selectors.test.ts`.

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
