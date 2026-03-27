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
- Keep modules small for agent context safety:
  - target <= 300 LOC per implementation file when practical.
  - if a file grows past 500 LOC, plan/extract focused submodules before adding new behavior.
  - exception: generated files, schema/fixture snapshots, and integration test aggregations.

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
- Apple-family target changes must keep `src/utils/device.ts`, `src/core/capabilities.ts`, `src/core/dispatch-resolve.ts`, `src/platforms/ios/devices.ts`, and `src/platforms/ios/runner-xctestrun.ts` in sync.
- iOS simulator-set scoping is iOS-specific: do not let `iosSimulatorDeviceSet` hide the host macOS desktop target when `--platform macos` or `--target desktop` is requested.
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
- New element-targeting interactions must support selector + `@ref`, record `selectorChain`, and hook replay healing (`healReplayAction` in `session.ts` + selector helpers in `session-replay-heal.ts`).
- New selector keys remain centralized in `selectors.ts`.
- New `is` predicates belong in `evaluateIsPredicate`.
- On macOS, snapshot rects are absolute in window space. Point-based runner interactions must translate through the interaction root frame; do not assume app-origin `(0,0)` coordinates.
- Prefer selector or `@ref` interactions over raw x/y commands in tests and docs, especially on macOS where window position can vary across runs.

## Testing Matrix
- Docs/skills only: no tests required.
- Non-TS, no behavior impact: no tests unless requested.
- Any TS change: `pnpm typecheck`.
- Daemon handler/shared module change: `pnpm test:unit` and `pnpm test:smoke`.
- iOS runner/Swift change: `pnpm build:xcuitest`.
- Cross-platform behavior change: run `pnpm test:integration`.
- Any change in: `src/`, `test/`, `skills/`: `pnpm format`.

## Token Guardrails
- Do not read unrelated files once owning module is identified.
- Do not run integration tests by default.
- Do not inspect both iOS and Android codepaths unless task requires both.
- Prefer targeted `git diff -- <paths>` over broad file reads during review.
- Prefer `snapshot -i`, `find`, and scoped selectors over repeated full snapshot dumps when exploring Apple desktop UIs.
- Keep PR summaries short and scoped.

## Common Mistakes
- Adding command logic to `src/daemon.ts` instead of handlers.
- Adding capability checks outside `src/core/capabilities.ts`.
- Inlining `is` predicate logic in handlers.
- Returning non-normalized user-facing errors.
- Duplicating logs backend logic in handlers instead of `src/daemon/app-log.ts`.
- Growing `src/daemon/handlers/session.ts` or `src/platforms/ios/apps.ts` further without extracting Apple-family/macOS-specific helpers first.

## Docs & Skills
- For behavior/CLI surface changes, evaluate docs/skills updates.
- Update `README.md` and relevant `website/docs/**` pages for command behavior/flags/aliases/workflows.
- Update relevant `skills/**/SKILL.md` when usage examples/workflow recommendations change.
- Keep skill docs task-first:
  - top-level `SKILL.md` should stay a thin router, not a full manual.
  - keep detailed workflows/troubleshooting in a `references/` folder instead of growing the router.
  - isolate true platform/infra exceptions (for example macOS-only or remote-tenancy-only guidance) in dedicated files.
  - do not delete high-value operational guidance during refactors; move or condense it unless the behavior is obsolete.
- Optimize skills for cheap, less capable models:
  - keep routing explicit, shallow, and easy to follow in one pass.
  - prefer short task-first steps, concrete commands, and low-ambiguity wording over dense prose.
  - avoid long reference chains or “figure it out” guidance when a direct next action can be stated.
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
- Commit messages and PR titles should use conventional prefixes such as `feat:`, `fix:`, `chore:`, `perf:`, `refactor:`, `docs:`, `test:`, `build:`, or `ci:` as appropriate.
- Do not use bracketed automation prefixes such as `[codex]` or similar bot tags in commit messages or PR titles.
- Open a ready-for-review PR by default. Use a draft PR only when the user explicitly asks for one or the work is intentionally incomplete.
- Run required checks for touched scope from **Testing Matrix**.
- PR body must be short and include:
  - `## Summary`
  - `## Validation` with exact commands run
- Call out known gaps/follow-ups explicitly.
- Include touched-file count and note if scope expanded beyond initial command family.

## Priority Order
- When guidance conflicts, apply in this order: **Hard Rules -> Scope -> Testing Matrix -> style/preferences**.
