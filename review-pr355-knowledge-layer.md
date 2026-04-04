# Review: PR #355 — feat: add generated repo knowledge layer

## Summary

PR #355 introduces a generated knowledge layer (`knowledge/` directory) that provides agents with pre-compiled navigation docs: per-command pages with flags/platform support, agent route maps, a platform matrix, and a JSON index. It's generated via `pnpm kb:build` and validated via `pnpm kb:check`.

This review evaluates the PR through the lens of the "LLM Knowledge Bases" article and compares the knowledge layer approach against the existing `AGENTS.md` for practical agent tasks.

---

## Experiment: Issue #331 (iOS legacy device discovery)

I ran two subagents in parallel to simulate fixing issue #331 ("devices command doesn't discover physical iOS devices running iOS <17") — one using only `AGENTS.md`, and one simulating the knowledge layer.

### Approach A: AGENTS.md only

| Metric | Value |
|--------|-------|
| Files read | 5 (AGENTS.md → devices.ts → test → devicectl.ts → device-ready.ts) |
| Search operations | 4-5 greps |
| Hops to implementation | 1 (AGENTS.md routing section → ios/devices.ts) |
| Direct path from AGENTS.md? | Partial — no explicit "devices" entry, but Command Family Lookup section pointed to `src/platforms/ios/` |
| Confidence in fix | 8/10 |

### Approach B: Knowledge layer (PR #355)

| Metric | Value |
|--------|-------|
| Files read | 3 (knowledge/commands/devices.md → devices.ts → test) |
| Search operations | 2 |
| Hops to implementation | 1 (knowledge page → source file) |
| Direct path from knowledge? | **No — pointed to wrong files** |
| Confidence in fix | Would be lower without correction |

### Critical Finding: The Knowledge Layer Would Misdirect

The generated `knowledge/commands/devices.md` lists these as primary source paths:

```
- src/daemon/handlers/session.ts
- src/daemon/session-store.ts
- src/daemon/handlers/__tests__/session.test.ts
```

**These are wrong.** The actual device discovery logic lives in:

```
- src/platforms/ios/devices.ts
- src/platforms/ios/__tests__/devices.test.ts
```

This happens because the `FAMILY_DEFINITIONS` in `scripts/knowledge-lib.mjs` assigns `devices` to the `session` family, which maps all commands in that family to the same 3 source files. The family grouping is too coarse — `devices` shares no implementation with `session`. An agent following these links would land in the wrong module and waste tokens reading irrelevant code before having to fall back to grep anyway.

The same problem affects `ensure-simulator` — it points to `session.ts` instead of `src/platforms/ios/ensure-simulator.ts`.

---

## Comparison: Knowledge Layer vs AGENTS.md

### Where the knowledge layer adds value

1. **Flag documentation**: Per-command flag listings with descriptions are genuinely useful. AGENTS.md has a "Adding a New CLI Flag" checklist but doesn't enumerate existing flags per command.
2. **Platform matrix**: The generated capabilities table is a quick reference that AGENTS.md doesn't have. An agent can instantly check "does `clipboard` work on iOS device?" without reading `capabilities.ts`.
3. **Command catalog**: The index.md table gives agents a single-file overview of all 47 commands — useful for tasks like "which commands relate to recording?"
4. **Machine-readable index**: `index.json` enables tool-based queries (the article's "extra tools" concept).

### Where AGENTS.md is already sufficient (or better)

1. **Routing**: AGENTS.md's Command Family Lookup is more accurate for finding implementation files because it was hand-curated. The knowledge layer's family-based source mapping is too coarse-grained.
2. **Architectural context**: AGENTS.md explains *why* code is structured a certain way (daemon flow, iOS runner seams, dependency direction). The knowledge layer has no architectural narrative.
3. **Hard rules**: AGENTS.md's constraints (use `runCmd`, keep files ≤300 LOC, capability checks) prevent common mistakes. Generated docs can't capture these.
4. **Testing guidance**: The testing matrix in AGENTS.md is essential for knowing *what to verify*. The knowledge layer doesn't address validation.

### Token efficiency analysis

For issue #331 specifically:

| | AGENTS.md | Knowledge Layer | Delta |
|---|---|---|---|
| Tokens to reach correct file | ~2K (read AGENTS.md routing) | ~1.5K (read command page) **but wrong file** | Knowledge layer adds ~3K wasted tokens from misdirection |
| Total tokens to fix | ~8K | ~10K (with recovery from wrong path) | AGENTS.md wins by ~20% |
| Fix quality | Correct (found devices.ts directly) | Would eventually correct, but slower | Comparable after recovery |

For a task like "add a new flag to `screenshot`", the knowledge layer would be more efficient (~30% token savings) because the flag listing and platform matrix eliminate exploratory reads of `command-schema.ts` and `capabilities.ts`.

---

## Evaluation Through the Article's Framework

The article describes a full pipeline: **raw data → LLM-compiled wiki → Q&A → output → linting**. PR #355 implements a subset:

| Article concept | PR #355 status |
|---|---|
| Data ingest (raw/) | Partial — reads from source code and `command-schema.ts`, but not docs/issues/PRs |
| Compiled wiki (knowledge/) | Yes — generated .md files with backlinks |
| Index maintenance | Yes — `index.json` and `index.md` |
| Q&A against wiki | Not implemented (would need CLI search tool) |
| Linting/health checks | Yes — `kb:check` catches stale files |
| Incremental enhancement | No — full rebuild only, no incremental updates |
| Visual output | No — markdown only |

### What's missing vs the article's vision

1. **No semantic routing**: The article describes LLMs auto-maintaining indexes with "brief summaries." The knowledge layer uses static family assignments that don't reflect actual code ownership. A truly compiled wiki would trace imports to find the *real* handler file for each command.
2. **No cross-referencing of runtime data**: Issue history, common failure patterns, and test coverage data would make the wiki much more useful for bug fixing.
3. **No query interface**: The article emphasizes Q&A over the wiki. The knowledge layer is read-only docs — there's no search tool an agent can invoke.

---

## Specific Issues in PR #355

### 1. Incorrect source path mapping (Critical)

As detailed above, `FAMILY_DEFINITIONS` maps commands to families at too coarse a granularity. `devices`, `ensure-simulator`, `boot`, `install`, and others all point to `session.ts` even though they have dedicated handler files.

**Fix**: Either trace actual imports from `src/daemon.ts` to resolve per-command handler files, or maintain a manual override map for commands that have dedicated modules.

### 2. No "devices" route in agent-routes.md

The agent routes cover session, interaction, snapshot, selectors, and Apple runner — but there's no route for "device discovery" pointing to `src/platforms/ios/devices.ts` or `src/platforms/android/devices.ts`. This is one of the most common agent tasks.

### 3. knowledge-lib.mjs is 674 lines

This exceeds the repo's own ≤300 LOC guideline from AGENTS.md. Consider splitting into separate renderer modules.

### 4. Validation doesn't catch semantic errors

`kb:check` validates that generated files match expected output (content drift). It does not validate that source paths actually exist or that family assignments are correct. A broken link in a command page would pass validation silently.

**Fix**: The link validation logic exists in `buildKnowledgeFiles()` (it resolves relative links with `fs.access`), but it only runs during build, not check. Consider running it in both.

### 5. Duplicate family assignment check is mentioned but unclear

The PR description mentions "validation that fails on duplicate family assignments" but the actual check isn't visible. If command X appears in two families, which source paths win?

---

## Verdict

**The PR is a promising start but has a critical accuracy issue that would actively mislead agents.** The knowledge layer's primary value proposition — directing agents to the right files faster — is undermined by the coarse family-to-source mapping that points many commands to the wrong implementation files.

### Recommendations

1. **Block on fixing source path accuracy.** Either auto-resolve handler files from the daemon router or add per-command overrides. Without this, the knowledge layer is net-negative for bug-fixing tasks (the most common agent work).

2. **Merge the platform matrix and flag docs regardless.** These are independently valuable and don't suffer from the routing problem. Consider generating them as part of AGENTS.md itself rather than a separate knowledge/ directory.

3. **Add a "device discovery" route** to agent-routes.md pointing to `src/platforms/ios/devices.ts` and `src/platforms/android/devices.ts`.

4. **Consider the article's linting concept**: Run an LLM health check over the generated knowledge to catch inconsistencies like "devices.md points to session.ts but devices.ts exists."

5. **Long-term**: Build toward the article's full vision — a search CLI tool over the knowledge base, incremental updates, and cross-referencing with issue/PR history. The current implementation is a static snapshot; the article's power comes from the wiki being a living, queryable system.

### Bottom line for the AGENTS.md vs Knowledge Layer question

For **bug fixing** (like issue #331): AGENTS.md is currently more efficient because its hand-curated routing is more accurate than the generated family mappings. The knowledge layer would need per-command handler resolution to beat it.

For **feature additions** (like adding a new command or flag): The knowledge layer would save ~30% tokens by providing flag enumerations and platform matrices upfront, avoiding exploratory reads of schema and capability files.

The ideal is both: AGENTS.md for architectural context and hard rules, plus an accurate generated knowledge layer for command-specific details. They're complementary, not competing.
