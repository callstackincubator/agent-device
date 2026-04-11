# AGENTS.md

Minimal operating guide for AI coding agents in this repo.

## First 60 Seconds
- Classify task type:
  - Info-only (triage/review/questions/docs guidance): no code edits and no test runs unless explicitly requested.
  - Code change: make minimal scoped edits and run only required checks from **Testing Matrix**.
- State assumptions explicitly. If uncertain, ask.
- If the task touches tooling/builds/linting, read `package.json` and `tsconfig*.json` before source files.
- Prefer repo scripts over reconstructing command bundles by hand:
  - `pnpm check:quick`: lint + typecheck
  - `pnpm check:tooling`: lint + typecheck + build
  - `pnpm check:unit`: unit + smoke
  - `pnpm check`: full non-integration validation
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
- Keep tests minimal: if TypeScript can enforce a contract or invalid shape, prefer a type-level check over duplicating that assertion in runtime tests.
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

## Toolchain Snapshot
- Package manager: `pnpm` only. Do not add or restore `package-lock.json`.
- Runtime baseline is Node >= 22. Prefer built-in Node APIs such as global `fetch`, Web Streams, and `AbortSignal.timeout` over compatibility wrappers unless the surrounding code needs a lower-level transport.
- Lint/format stack is OXC:
  - config: `.oxlintrc.json`, `.oxfmtrc.json`
- TypeScript is strict enough to surface dead code early: `strict`, `isolatedModules`, `noUnusedLocals`, and `noUnusedParameters` are enabled.
- The repo emits with `rslib`, not `tsc`. If declaration generation fails, inspect `tsconfig.lib.json` first.
- `tsconfig.lib.json` needs an explicit `rootDir: "./src"` for declaration layout.
- Use the aggregate scripts in `package.json` when possible; they encode the expected validation bundles better than ad hoc command lists.

## Cheap Exploration
- Prefer these first-pass commands over broader reads:
  - `rg -n "<symbol|command|flag>" src test`
  - `rg --files src/daemon/handlers src/platforms/ios src/platforms/android`
  - `git diff -- <path>` for active-branch context
  - read `.oxlintrc.json` before treating lint output as source-level bugs
- If build/type errors mention declaration generation, inspect `tsconfig.lib.json` before reading platform code.
- If lint failures appear after toolchain edits, check whether the rule is from `eslint/*`, `typescript/*`, `import/*`, or `node/*` in `.oxlintrc.json` before assuming source bugs.

## Command Family Lookup
- `logs`: `src/daemon/handlers/session.ts` -> `src/daemon/app-log.ts` -> `src/daemon/handlers/__tests__/session.test.ts`
- `open/close/replay/apps/appstate`: `src/daemon/handlers/session.ts` -> `src/daemon/session-store.ts` -> `src/daemon/handlers/__tests__/session.test.ts`
- `click/fill/get/is`: `src/daemon/handlers/interaction.ts` -> `src/daemon/selectors.ts` -> `src/daemon/handlers/__tests__/interaction.test.ts`
- `snapshot/wait/settings/alert`: `src/daemon/handlers/snapshot.ts` -> `src/daemon/snapshot-processing.ts` -> `src/daemon/handlers/__tests__/snapshot-handler.test.ts`
- `record/trace`: `src/daemon/handlers/record-trace.ts` -> `src/platforms/ios/runner-client.ts` -> `src/daemon/handlers/__tests__/record-trace.test.ts`

## iOS Runner Seams
- Keep dependency direction clean:
  - `runner-client.ts`: command execution + retry behavior
  - `runner-transport.ts`: connection/probing/HTTP transport
  - `runner-contract.ts`: shared `RunnerCommand` type and runner connect/error helpers
  - `runner-session.ts`: session lifecycle and request/response execution
  - `runner-xctestrun.ts`: xctestrun preparation/build/cache logic
- `runner-transport.ts` must not import back from `runner-client.ts`.
- If changing runner connect errors, retry policy, or command typing, start in `src/platforms/ios/runner-contract.ts` before touching client/transport files.

## Adding a New CLI Flag

A new snapshot/command flag touches up to 7 files in a fixed order. Follow this checklist:

1. `src/utils/command-schema.ts`: add to `CliFlags` type, `FLAG_DEFINITIONS` array, and the relevant `*_FLAGS` constant (e.g. `SNAPSHOT_FLAGS`). Update the command's `usageOverride` string.
2. `src/utils/snapshot.ts` (or the relevant options type): add to `SnapshotOptions` or equivalent.
3. `src/client-types.ts`: add to `CaptureSnapshotOptions` (or equivalent public options type) **and** `InternalRequestOptions`.
4. `src/client-normalizers.ts`: map the public option name to the internal flag name in `buildFlags`.
5. `src/daemon/context.ts`: add to `DaemonCommandContext` type and `contextFromFlags` function.
6. `src/core/dispatch.ts`: add to the inline context type on `dispatchCommand` and thread it to the platform call.
7. `src/cli/commands/<command>.ts`: pass the flag from `flags.*` to the client call.

Command-only flags (like `find --first`) that don't flow to the platform layer only need steps 1 and the handler file.

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

## Optional Optimizations
- Treat optional optimization calls such as cache/preflight/probe requests as best-effort unless the feature contract says they are required. If an optimization fails, times out, returns non-OK, or returns an unusable shape, prefer falling back to the existing required command path.
- Keep optimization timeouts shorter than the underlying operation timeout. A preflight should not consume the full budget for a later upload or command.

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

## Shared Test Utilities
- Before writing a new test, check `src/__tests__/test-utils/` for existing helpers:
  - `device-fixtures.ts`: canonical `DeviceInfo` constants (`ANDROID_EMULATOR`, `IOS_SIMULATOR`, `IOS_DEVICE`, `MACOS_DEVICE`, `LINUX_DEVICE`, etc.)
  - `session-factories.ts`: `makeSession`, `makeIosSession`, `makeAndroidSession`, `makeMacOsSession`
  - `store-factory.ts`: `makeSessionStore` (creates temp `SessionStore` instances)
  - `snapshot-builders.ts`: `buildNodes`, `makeSnapshotState`
  - `mocked-binaries.ts`: `withMockedAdb`, `withMockedXcrun` (stub CLI binaries for dispatch tests)
- Use `import { ... } from '<relative-path>/__tests__/test-utils/index.ts'` for convenient barrel imports.
- Prefer shared fixtures over inlining new `DeviceInfo` or `SessionState` objects in tests.
- Do not duplicate `makeSessionStore`, `makeSession`, or device constants when a shared helper already exists.

## Testing Matrix
- Docs/skills only: no tests required.
- Non-TS, no behavior impact: no tests unless requested.
- Keep tests behavioral; do not assert shapes or cases TypeScript already proves.
- Any TS change: `pnpm typecheck` or `pnpm check:quick`.
- Tooling/config change (`package.json`, `tsconfig*.json`, `.oxlintrc.json`, `.oxfmtrc.json`): `pnpm check:tooling`.
- Daemon handler/shared module change: `pnpm check:unit`.
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
- Reintroducing an npm lockfile or assuming ESLint/Prettier still exist in this repo.
- Changing `tsconfig.lib.json`/build tooling without running `pnpm check:tooling`; declaration generation is stricter than `tsc --noEmit`.

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
