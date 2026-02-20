# AGENTS.md

Minimal operating guide for AI coding agents in this repo.

## Before Implementing
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.

## Code Changes
- Minimum code that solves the problem. No speculative features.
- No abstractions for single-use code.
- Surgical edits: touch only what the task requires.
- Match existing style, even if you'd do it differently.
- Remove imports/variables YOUR changes made unused; don't touch pre-existing dead code.

## Verification
- Transform tasks into verifiable goals with clear success criteria.
- For multi-step tasks, state a brief plan with verification checkpoints.

## Scope
- Solve issues with the smallest context read.
- Keep changes scoped to one command family or module group.
- Preserve daemon session semantics and platform behavior.
- Read at most 3 files first:
  - the owning handler/module
  - one shared helper used by that handler
  - one downstream platform file if needed
- Expand only when contracts cross module boundaries.
- Do not read both iOS and Android paths unless the issue is explicitly cross-platform.

## Routing
- Keep `src/daemon.ts` as a thin router.
- Put command logic in handler modules:
  - session/apps/appstate/open/close/replay: `src/daemon/handlers/session.ts`
  - click/fill/get/is: `src/daemon/handlers/interaction.ts`
  - snapshot/diff/wait/alert/settings: `src/daemon/handlers/snapshot.ts`
  - find: `src/daemon/handlers/find.ts`
  - record/trace: `src/daemon/handlers/record-trace.ts`
- Generic passthrough (press/scroll/type) is daemon fallback only after handlers return null.

## Hard Rules

- Use `runCmd`/`runCmdSync` from `src/utils/exec.ts` for process execution.
- Use daemon session flow for interactions (`open` before interactions, `close` after).
- Do not remove shared snapshot/session model behavior without full migration.
- If Swift runner code changes, run `pnpm build:xcuitest`.
- Use `inferFillText` and `uniqueStrings` from `src/daemon/action-utils.ts`. Do not duplicate.
- Use `evaluateIsPredicate` from `src/daemon/is-predicates.ts` for assertion logic. Do not inline.

## Diagnostics & Errors

- Use `src/utils/diagnostics.ts` as the diagnostics source of truth:
  - `withDiagnosticsScope`
  - `emitDiagnostic`
  - `withDiagnosticTimer`
  - `flushDiagnosticsToSessionFile`
- Do not add ad-hoc stderr/file logging in handlers/platform modules when diagnostics helpers can be used.
- Normalize user-facing failures through `src/utils/errors.ts` (`normalizeError`).
- Failure payload contract should include: `code`, `message`, `hint`, `diagnosticId`, `logPath`, `details`.
- When wrapping/rethrowing daemon errors (batch/replay/handler wrappers), preserve `hint`, `diagnosticId`, and `logPath` from inner errors.
- `--debug` is canonical; `--verbose` remains backward-compatible alias.
- Keep redaction centralized in `src/utils/diagnostics.ts`; do not duplicate redaction logic in handlers/CLI.

## Key Files
- CLI parse + formatting: `src/bin.ts`, `src/cli.ts`, `src/utils/args.ts`
- Daemon client transport: `src/daemon-client.ts`
- Daemon state/store: `src/daemon/session-store.ts`
- Selector DSL and matching: `src/daemon/selectors.ts`
- `is` predicate evaluation: `src/daemon/is-predicates.ts`
- Shared action helpers: `src/daemon/action-utils.ts`
- Snapshot shaping + labels: `src/daemon/snapshot-processing.ts`
- Handler context helpers: `src/daemon/context.ts`, `src/daemon/device-ready.ts`
- Dispatcher and capability source of truth: `src/core/dispatch.ts`, `src/core/capabilities.ts`
- Platform backends: `src/platforms/ios/*`, `ios-runner/*`, `src/platforms/android/*`

## Capability Source Of Truth

- Command/device support must come from `src/core/capabilities.ts`.
- Do not scatter new support checks across handlers.

## Selector System Rules

- Interaction commands (`click`, `fill`, `get`, `is`) and `wait` accept selectors and `@ref`.
- Pipeline is: **parse -> resolve -> act -> record selectorChain -> heal on replay**.
- Keep selector parsing/matching in `src/daemon/selectors.ts`.
- Call `buildSelectorChainForNode` after resolving an interaction target.
- New element-targeting interactions must support selector input and `@ref`, record `selectorChain`, and hook replay healing (`healReplayAction` + `collectReplaySelectorCandidates` in `session.ts`).
- New selector key updates stay centralized in `selectors.ts` (`SelectorKey`, key sets, matcher, token checks).
- New `is` predicates belong in `evaluateIsPredicate` (`src/daemon/is-predicates.ts`), not handler code.

## Testing
- Unit tests are colocated with source files under `src/**`.
- Use `__tests__` folders colocated with the related source folder.
- The `test/**` tree is integration-only (including smoke integration tests).
- Example: tests for `src/daemon/selectors.ts` go in `src/daemon/__tests__/selectors.test.ts`.
- Add/extend colocated unit tests in the same PR for touched module logic.
- Any TS change:
  - `pnpm typecheck`
- Daemon handler/shared module change:
  - `pnpm test:unit`
  - `pnpm test:smoke`
- iOS runner/Swift change:
  - `pnpm build:xcuitest`

Run integration tests when behavior crosses platform boundaries:
- `pnpm test:integration`

## Measurement
- Track files touched per fix, cycle time, and iOS/Android regressions.

## Local Commands

- Run CLI: `pnpm ad <command>`
- For verification commands, use the **Testing** section above.

## Pull Requests
- Before opening PR: ensure no conflict markers and no unmerged paths.
- Run required checks for touched scope (at minimum `pnpm typecheck`; plus test commands from **Testing** above).
- PR body must be short and include:
  - `## Summary` with key behavior changes
  - `## Validation` with exact commands run
- Call out known gaps or follow-ups explicitly; do not hide failing checks.
