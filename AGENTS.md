# AGENTS.md

Minimal operating guide for AI coding agents in this repo.

## First 60 Seconds
- Classify task type:
  - Info-only (triage/review/questions/docs guidance): no code edits and no test runs unless explicitly requested.
  - Code change: make minimal scoped edits and run only required checks from **Testing Matrix**.
- State assumptions explicitly. If uncertain, ask.
- Read at most 3 files first:
  - owning handler/module
  - one shared helper used by that handler
  - one downstream platform file if needed
- Define verifiable success criteria before editing.
- Decide docs/skills impact up front.

## Scope
- Solve issues with the smallest context read.
- Keep changes scoped to one command family or module group.
- Preserve daemon session semantics and platform behavior.
- Expand only when contracts cross module boundaries.
- Do not read both iOS and Android paths unless explicitly cross-platform.
- If requested fix expands beyond one command family/module group, stop and confirm before broadening scope.

## Code Changes
- Minimum code that solves the problem. No speculative features.
- No abstractions for single-use code.
- Surgical edits only.
- Match existing style.
- Remove imports/variables YOUR changes made unused; do not clean unrelated dead code.

## Routing
- Keep `src/daemon.ts` as a thin router.
- Put command logic in handler modules:
  - session/apps/appstate/open/close/replay/logs: `src/daemon/handlers/session.ts`
  - click/fill/get/is: `src/daemon/handlers/interaction.ts`
  - snapshot/wait/alert/settings: `src/daemon/handlers/snapshot.ts`
  - find: `src/daemon/handlers/find.ts`
  - record/trace: `src/daemon/handlers/record-trace.ts`
- Generic passthrough (press/scroll/type) is daemon fallback only after handlers return null.

## Command Family Lookup
- `logs`: `src/daemon/handlers/session.ts` -> `src/daemon/app-log.ts` -> `src/daemon/handlers/__tests__/session.test.ts`
- `open/close/replay/apps/appstate`: `src/daemon/handlers/session.ts` -> `src/daemon/session-store.ts` -> `src/daemon/handlers/__tests__/session.test.ts`
- `click/fill/get/is`: `src/daemon/handlers/interaction.ts` -> `src/daemon/selectors.ts` -> `src/daemon/handlers/__tests__/interaction.test.ts`
- `snapshot/wait/settings/alert`: `src/daemon/handlers/snapshot.ts` -> `src/daemon/snapshot-processing.ts` -> `src/daemon/handlers/__tests__/snapshot-handler.test.ts`
- `record/trace`: `src/daemon/handlers/record-trace.ts` -> `src/platforms/ios/runner-client.ts` -> `src/daemon/handlers/__tests__/record-trace.test.ts`

## Hard Rules
- Use `runCmd`/`runCmdSync` from `src/utils/exec.ts` for process execution.
- Use daemon session flow for interactions (`open` before interactions, `close` after).
- Do not remove shared snapshot/session model behavior without full migration.
- Command/device support must come from `src/core/capabilities.ts`.
- If Swift runner code changes, run `pnpm build:xcuitest`.
- Use `inferFillText` and `uniqueStrings` from `src/daemon/action-utils.ts`.
- Use `evaluateIsPredicate` from `src/daemon/is-predicates.ts` for assertion logic.

## Logs Contract
- Logs backend/source of truth is `src/daemon/app-log.ts`.
- `session.ts` should orchestrate only (start/stop/path/doctor/mark), not duplicate backend logic.
- Preserve external grep/tail workflow in docs/skills.

## Diagnostics & Errors
- Diagnostics source of truth: `src/utils/diagnostics.ts`
  - `withDiagnosticsScope`, `emitDiagnostic`, `withDiagnosticTimer`, `flushDiagnosticsToSessionFile`
- Do not add ad-hoc stderr/file logging where diagnostics helpers apply.
- Normalize user-facing failures via `src/utils/errors.ts` (`normalizeError`).
- Failure payload contract: `code`, `message`, `hint`, `diagnosticId`, `logPath`, `details`.
- Preserve `hint`, `diagnosticId`, `logPath` when wrapping/rethrowing errors.
- `--debug` is canonical; `--verbose` is backward-compatible alias.
- Keep redaction centralized in diagnostics helpers.

## Selector System Rules
- Interaction commands (`click`, `fill`, `get`, `is`) and `wait` accept selectors and `@ref`.
- Pipeline: **parse -> resolve -> act -> record selectorChain -> heal on replay**.
- Keep selector parsing/matching in `src/daemon/selectors.ts`.
- Call `buildSelectorChainForNode` after resolving target nodes.
- New element-targeting interactions must support selector + `@ref`, record `selectorChain`, and hook replay healing (`healReplayAction` + `collectReplaySelectorCandidates` in `session.ts`).
- New selector keys remain centralized in `selectors.ts`.
- New `is` predicates belong in `evaluateIsPredicate`.

## Testing Matrix
- Docs/skills only: no tests required.
- Non-TS, no behavior impact: no tests unless requested.
- Any TS change: `pnpm typecheck`.
- Daemon handler/shared module change: `pnpm test:unit` and `pnpm test:smoke`.
- iOS runner/Swift change: `pnpm build:xcuitest`.
- Cross-platform behavior change: run `pnpm test:integration`.

## Token Guardrails
- Do not read unrelated files once owning module is identified.
- Do not run integration tests by default.
- Do not inspect both iOS and Android codepaths unless task requires both.
- Keep PR summaries short and scoped.

## Common Mistakes
- Adding command logic to `src/daemon.ts` instead of handlers.
- Adding capability checks outside `src/core/capabilities.ts`.
- Inlining `is` predicate logic in handlers.
- Returning non-normalized user-facing errors.
- Duplicating logs backend logic in handlers instead of `src/daemon/app-log.ts`.

## Docs & Skills
- For behavior/CLI surface changes, evaluate docs/skills updates.
- Update `README.md` and relevant `website/docs/**` pages for command behavior/flags/aliases/workflows.
- Update relevant `skills/**/SKILL.md` when usage examples/workflow recommendations change.
- In final summaries, state whether docs/skills were updated; if not, explain why.

## When Blocked
- If blocked by network/device/auth/permissions, stop and report:
  - blocker
  - why it blocks completion
  - exact next command/action needed to unblock

## Key Files
- CLI parse + formatting: `src/bin.ts`, `src/cli.ts`, `src/utils/args.ts`
- Daemon client transport: `src/daemon-client.ts`
- Daemon state/store: `src/daemon/session-store.ts`
- Selector DSL and matching: `src/daemon/selectors.ts`
- `is` predicate evaluation: `src/daemon/is-predicates.ts`
- Shared action helpers: `src/daemon/action-utils.ts`
- Snapshot shaping + labels: `src/daemon/snapshot-processing.ts`
- Handler context helpers: `src/daemon/context.ts`, `src/daemon/device-ready.ts`
- Dispatcher + capability map: `src/core/dispatch.ts`, `src/core/capabilities.ts`
- Platform backends: `src/platforms/ios/*`, `ios-runner/*`, `src/platforms/android/*`

## Pull Requests
- Before opening PR: ensure no conflict markers/unmerged paths.
- Run required checks for touched scope from **Testing Matrix**.
- PR body must be short and include:
  - `## Summary`
  - `## Validation` with exact commands run
- Call out known gaps/follow-ups explicitly.
- Include touched-file count and note if scope expanded beyond initial command family.

## Priority Order
- When guidance conflicts, apply in this order: **Hard Rules -> Scope -> Testing Matrix -> style/preferences**.
