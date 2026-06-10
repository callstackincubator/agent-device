# agent-device — Technical Audit & Improvement Plan

Date: 2026-06-10 · Version audited: 0.17.1 (commit `1de7e73`) · Scope: full repository, analysis only

---

## 1. Executive Summary

**Overall health: A−.** This is a production-grade, actively maintained OSS product with engineering hygiene well above the OSS norm: zero `any` in ~97k LOC of production TypeScript, exactly one runtime dependency (`yaml`), a clean dead-code baseline, per-PR real-emulator smoke CI plus nightly device replay suites, and a deliberately hardened security posture (loopback-only daemon, random per-boot token stored 0600, tar-traversal and upload-size defenses). No Critical findings in the product code itself; the repo's single Critical Dependabot alert (CVE-2026-9277, `shell-quote@1.8.3`) sits in the example app's lockfile, not the published package, and is a one-line override to fix. Nothing in the codebase looks negligent. The grade is A− rather than A because complexity is concentrating in a few load-bearing monoliths — above all `src/daemon-client.ts` (1,801 LOC, four functions grandfathered as complexity-critical) — and because the layering between `commands/`, `daemon/`, and `platforms/` is drifting (the daemon imports from the CLI commands layer in 10+ files). **Top 3 risks:** (1) daemon-client lifecycle/transport code is the hardest-to-test, most failure-prone path and keeps absorbing complexity; (2) the largest platform modules (iOS app resolution, Android app lifecycle, Maestro compat) have no direct unit tests, so refactoring them is risky; (3) lint/format are configured but not enforced in CI, so the quality gate is weaker than it appears. **Top 3 opportunities:** (1) a one-hour CI lint/format gate closes the cheapest gap; (2) extracting shared contracts out of `src/commands/` restores a clean dependency direction and unblocks future daemon/cloud separation; (3) splitting `daemon-client.ts` along its four obvious seams converts the riskiest file into four testable modules.

---

## 2. Repo Map

**Purpose.** `agent-device` is a device-automation CLI (and MCP server) that lets AI coding agents open, inspect, interact with, and collect evidence from real apps on iOS, Android, tvOS, Android TV, macOS, and Linux. Published on npm by Callstack, MIT-licensed, v0.17.1, with a docs site, cloud offering, and named production users — this is a maintained product, not a prototype. Audit recommendations are calibrated accordingly.

**Stack.** TypeScript (ESM, `module: NodeNext`, Node ≥ 22.19), built with rslib, tested with vitest + `node --test`, linted with oxlint, formatted with oxfmt, dead-code/health-audited with fallow, packaged with pnpm. Native companions: a Swift XCUITest runner (`ios-runner/`), a Swift macOS helper (`macos-helper/`), Android snapshot/multitouch helper APKs (`android-snapshot-helper/`, built via shell scripts), and a Python AT-SPI dump for Linux (`src/platforms/linux/atspi-dump.py`).

**Architecture sketch.**

```
bin.ts → cli.ts → commands/ (grammar, flags, metadata)
                     │
                     ▼
          daemon-client.ts  ── spawns/locates per-user background daemon
                     │           (lock + info file in ~/.agent-device, token, PID,
                     │            version + code-signature reuse check :604-610)
                     ▼  JSON-RPC over loopback socket and/or HTTP (127.0.0.1, ephemeral port)
          daemon/ (http-server → request-router → handlers; sessions, leases,
                   artifacts, snapshot/selector runtime)
                     │  injected platform providers
                     ▼
          core/dispatch + interactors → platforms/{ios,android,macos,linux}
                     ▼
          XCUITest runner · ADB + helper APK · macOS helper · AT-SPI → device
```

The MCP server (`src/mcp/`) is a thin adapter that exposes the same command surface as tools over stdio — no duplicated logic. A replay engine (`src/replay/`, `.ad` scripts) and a Maestro compatibility layer (`src/compat/maestro/`) sit on top of the same dispatch path. Remote/cloud execution reuses the daemon protocol (`src/companion-tunnel.ts`, `src/remote-config*.ts`, lease registry, tenant isolation hooks).

**Key directories.**

| Path | Role |
| --- | --- |
| `src/commands/` | CLI grammar, flag/metadata catalog, command contracts (the public surface) |
| `src/core/` | Platform-agnostic dispatch + interactor interfaces |
| `src/daemon/` | Daemon server: routing, sessions, leases, artifacts, snapshot/selector runtime |
| `src/platforms/{ios,android,macos,linux}/` | Device backends (simctl/devicectl/XCUITest, ADB, helpers, AT-SPI) |
| `src/mcp/` | MCP stdio server (thin adapter) |
| `src/compat/maestro/`, `src/replay/` | Maestro YAML compat, `.ad` replay engine |
| `src/utils/` | Foundational utilities incl. custom PNG codec, screenshot diff suite |
| `test/integration/` | CLI/daemon smoke tests, provider-scenario tests, on-device replay suites |
| `website/`, `examples/test-app/`, `skills/` | Docs site, Expo fixture app, agent skills |
| `fallow-baselines/` | Grandfathered complexity/health findings (ratchet) |

**Scale.** 738 TS files; ~96.8k LOC production, ~73.2k LOC tests (242 unit-test files), 26 integration test files, 15 on-device replay scripts. 14 GitHub workflows.

**What surprised me (positively).** Zero `any` outside tests (verified by grep); a single runtime dependency; a custom zero-dep PNG codec rather than pulling in pngjs; `AGENTS.md` is a 304-line engineering playbook for AI contributors; CI includes bespoke guard jobs (`no-test-di-seams`, Swift trailing-comma compat in `.github/workflows/ci.yml:25-53`); daemon reuse is gated on version *and* binary code signature (`src/daemon-client.ts:604-610`).

**Review depth note.** Deep review: daemon, daemon-client, http-server, security surfaces (upload/artifact/tar/exec/token), CI, test architecture, layering. Lighter review: Swift/Kotlin native helpers, `website/`, `examples/test-app/`, the screenshot-diff/OCR algorithm internals, and `scripts/perf/`. Findings there would not change the grade but those areas received less scrutiny.

---

## 3. Audit Report

No Critical findings. Severity scale: High / Medium / Low. Each finding marked **[fact]** or **[judgment]**.

### 3.1 Architecture & design

**A1 — `src/daemon-client.ts` is a 1,801-line god file on the most failure-prone path. High.**
[fact] It mixes daemon discovery/spawn/lock-recovery (`startLocalDaemon`, `src/daemon-client.ts:612` ff.), socket-vs-HTTP transport selection and retries, progress-stream parsing, multipart artifact upload with resume/redirect logic (`sendHttpRequest`), streaming artifact download (`downloadRemoteArtifact`, ~`:1689-1777`), and lease RPC marshaling. Four of its functions are grandfathered as complexity-critical in `fallow-baselines/health.json` (`sendToDaemon`, `startLocalDaemon`, `sendHttpRequest`, `downloadRemoteArtifact`). Unit tests cover only fragments of it.
[judgment] Why it matters: daemon startup/connection is the single most common end-user failure mode for a tool like this, and this is the file every transport or lifecycle change must touch. Its size + branchiness + partial test coverage make it the highest-regression-risk area in the repo.

**A2 — Layering drift: the daemon (and platforms) import from the CLI `commands/` layer. Medium.**
[fact] 10+ daemon files import from `src/commands/`: e.g. `src/daemon/context.ts:6` (screenshot flag definitions), `src/daemon/handlers/interaction-touch-targets.ts:6-10` (CLI grammar), `src/daemon/screenshot-overlay.ts:10`, `src/daemon/handlers/react-native.ts:7`, `src/daemon/handlers/session-observability.ts:7-28`. Platform code imports `AppsFilter` from `src/commands/app-inventory-contract.ts` in 5 files (e.g. `src/platforms/android/app-lifecycle.ts:7`).
[judgment] `commands/` has become a de facto shared-vocabulary layer, so the dependency arrows now point both ways between the CLI surface and the daemon. This is not breaking anything today (fallow reports no circular deps), but it makes the daemon impossible to extract or version independently — which matters given the remote/cloud execution direction — and each new handler entrenches the pattern.

**A3 — Stale-daemon detection relies on OS-specific `ps` parsing. Low.**
[fact] Daemon reuse/staleness checks compare PID + process start time via `src/utils/process-identity.ts` (`ps`-based) plus version/code-signature from `daemon.json`.
[judgment] Fragile in unusual environments (containers, exotic locales affecting `ps` output), but failure degrades to "spawn a fresh daemon", which is safe. No action needed beyond awareness.

Healthy: provider injection (`src/daemon/request-router.ts:58-145`) keeps platforms swappable and made the provider-scenario test architecture possible; the MCP server is a genuinely thin adapter; contracts-first typing (`src/contracts.ts`, `src/runtime-contract.ts`) is consistently applied.

### 3.2 Code quality

**Q1 — Complexity debt is real but tracked: 180 grandfathered findings in the fallow health baseline. Medium.**
[fact] `fallow-baselines/health.json` grandfathers 180 items: 17 complexity-critical, 47 complexity-high, concentrated in `src/daemon-client.ts` (4 critical), `src/daemon/handlers/session-state.ts`, `src/core/dispatch.ts`, `src/cli.ts`. `fallow-baselines/dead-code.json` is empty (no dead exports, no cycles).
[judgment] A ratchet without a paydown plan tends to only grow. The baseline is the right mechanism; it needs a "shrink by N per quarter" policy to actually trend down.

**Q2 — Error handling is disciplined; swallowed exceptions are benign. Healthy (one sentence).**
[fact] 21 empty `catch {}` blocks and 23 no-op `.catch()` handlers exist (verified counts), but sampling shows all are best-effort cleanup in teardown/finally paths (e.g. `src/daemon/server-lifecycle.ts:98,107`, `src/daemon/handlers/session-close.ts:116,164,176`); none hide failures in command execution or request handling, and oxlint's `no-empty` is configured with `allowEmptyCatch` deliberately (`.oxlintrc.json`).

**Q3 — Type safety: zero `any` in production code. Healthy.**
[fact] `grep` for `: any` / `as any` outside tests returns 0 matches across 738 files, despite the lint rule being off — discipline is cultural, not just enforced.

**Q4 — One known-debt TODO in a hot comparison path. Low.**
[fact] `src/commands/snapshot-unchanged.ts:72` — `// TODO: replace stringify with a field-by-field comparison or stable presentation hash.` This is the only TODO/FIXME in the codebase.
[judgment] `JSON.stringify`-based snapshot identity is O(tree size) per comparison and allocation-heavy; for an agent loop that snapshots constantly, a stable hash is a cheap win.

No significant copy-paste duplication was found across platform backends; differences reflect genuinely different platform APIs, and the screenshot-diff suite (`src/utils/screenshot-diff-*.ts`, 9 files) is partitioned by concern, not duplicated.

### 3.3 Security

The security posture is deliberately engineered and, for a localhost developer daemon, strong. Verified facts:

- Daemon binds loopback only with ephemeral ports (`src/daemon/transport.ts:151`).
- Auth token is 24 random bytes per daemon boot (`src/daemon-runtime.ts:78`), persisted with mode 0600 (`src/daemon/server-lifecycle.ts:48-50`), enforced on every request including the socket transport (`src/daemon/request-router.ts:86`).
- Uploads: size cap with streaming byte enforcement (`src/daemon/artifact-download.ts:31-41`), filename sanitized to basename (`:17-24`), tar extraction validates entries against `../` traversal and an expected root (`src/daemon/artifact-archive.ts:124,131`).
- Artifact downloads resolve via a server-side registry ID with tenant scoping, never client-supplied paths (`src/daemon/artifact-tracking.ts:43-56`).
- No `shell: true` anywhere in production code; args are passed as arrays, with a correct POSIX quoting helper for the rare string contexts (`src/utils/shell-quote.ts`).
- No hardcoded secrets found (pattern scan over `src/`, `scripts/`).
- Update check is a plain GET to `registry.npmjs.org` (`src/utils/update-check.ts:153`) — no auto-install behavior.

Findings:

**S1 — Token comparisons are not timing-safe. Low.**
[fact] `req.token !== token` at `src/daemon/request-router.ts:86` and `requestToken === expectedToken` at `src/daemon/http-server.ts:821`.
[judgment] Practically unexploitable while the daemon is loopback-only with a 0600 token file — but the codebase also ships tenant isolation, lease backends, and an `AGENT_DEVICE_HTTP_AUTH_HOOK` (`src/daemon/http-server.ts:460-482`) that clearly anticipate network-fronted deployments. `crypto.timingSafeEqual` is a 5-line fix that removes the caveat.

**S2 — `daemon.json` mode 0600 applies only at file creation. Low.**
[fact] `fs.writeFileSync(..., { mode: 0o600 })` (`src/daemon/server-lifecycle.ts:48-50`) does not tighten permissions if the file already exists with looser perms (e.g. created by an older version or copied).
[judgment] Edge case; an explicit `fs.chmodSync(infoPath, 0o600)` after write closes it.

**S3 — Auth-hook dynamic import is an intentional but undocumented-in-repo trust boundary. Informational.**
[fact] `AGENT_DEVICE_HTTP_AUTH_HOOK` loads and executes an arbitrary module path from the environment (`src/daemon/http-server.ts:460-482`).
[judgment] Reasonable extension point (whoever sets the daemon's env already owns the process); worth one paragraph of threat-model documentation so cloud deployers don't point it at writable locations.

**S4 — Known-critical CVE in the example app's lockfile (the repo's one open Dependabot Critical). Medium for the repo, not the product.**
[fact] `pnpm audit` in `examples/test-app/` flags CVE-2026-9277 / GHSA-w7jw-789q-3m8p (critical, CVSS 8.1): `shell-quote@1.8.3` via `react-native > react-devtools-core`, fixed in 1.8.4. This matches the single critical Dependabot alert on the default branch. The root workspace (446 deps, the tree that ships in the npm package) audits clean, and the product's own `src/utils/shell-quote.ts` is an unrelated in-house helper.
[judgment] Exploitability through the Expo fixture app is negligible (dev-only, requires object-token `quote()` usage), but an open Critical alert on a security-conscious repo erodes signal — and the fix is a one-line `pnpm.overrides` entry (`"shell-quote": ">=1.8.4"`) in `examples/test-app/package.json` plus a lockfile refresh.

Dependencies otherwise: one runtime dep (`yaml@^2.9.0`), 11 devDeps, all current-generation (TypeScript 6, vitest 4, oxlint 1.57), pnpm lockfiles present at root and in `examples/test-app`. **Healthy.**

### 3.4 Testing

The overall test architecture is unusually good: behavior-asserting unit tests; "provider-scenario" integration tests that run the *real* daemon router and handlers against contract-compliant in-memory device providers (`test/integration/provider-scenarios/harness.ts`) with command/flag coverage tracked by `scripts/integration-progress.mjs`; per-PR platform smoke runs on real emulators/simulators (`.github/workflows/android.yml`, `ios.yml`, `macos.yml`, `linux.yml` all trigger on `pull_request`); and nightly full replay suites on devices (`replays-nightly.yml`). Coverage thresholds (78% statements / 80% lines) are enforced in CI, and the exclusion list in `vitest.config.ts:27-42` contains only re-export facades and type modules — nothing suspicious.

**T1 — The largest platform modules have no direct unit tests. High.**
[fact] `src/platforms/ios/apps.ts` (1,231 LOC), `src/compat/maestro/runtime-targets.ts` (1,080), `src/platforms/android/app-lifecycle.ts` (920), `src/client-metro.ts` (995) have no dedicated test files; they are exercised only indirectly via provider scenarios or on-device runs.
[judgment] These files encode exactly the kind of device-specific edge-case knowledge (bundle resolution quirks, install/launch fallbacks, Maestro semantics) that is expensive to rediscover after a regression. Nightly replays will catch happy-path breakage one day late; edge cases may not be caught at all. This is the main thing that makes refactoring the platform layer risky.

**T2 — `daemon-client.ts` lifecycle logic is only fragment-tested. Medium.**
[fact] Tests cover connection/timeout/stdin fragments; spawn-retry, stale-lock recovery, transport fallback, and artifact download/resume paths are largely untested at unit level.
[judgment] This compounds A1: the file most in need of refactoring lacks the safety net to refactor it. Fix the net first (see Milestone 0).

**T3 — A few real-time sleeps in unit tests. Low.**
[fact] e.g. `src/__tests__/cli-diagnostics.test.ts` (250–300 ms sleeps), 20–25 ms waits in `src/daemon/__tests__/request-router-*.test.ts`.
[judgment] Low flake risk, but the 250 ms+ ones are the kind that bite on saturated CI runners; convert to fake timers or condition-polling when touched.

### 3.5 Performance

**P1 — Synchronous zlib in the daemon event loop. Medium.**
[fact] The custom PNG codec uses `inflateSync`/`deflateSync` (`src/utils/png-codec.ts:1`) and is invoked from daemon request paths: `src/daemon/screenshot-overlay.ts:9` and `src/utils/screenshot-diff.ts:4`. The daemon is a single Node process potentially serving multiple sessions (and, in remote mode, multiple tenants).
[judgment] Decoding/diffing full-device screenshots (several MB) blocks the event loop for tens-to-hundreds of ms per operation, stalling *all* concurrent sessions' requests, heartbeats, and progress streams. Fine for single-agent local use; a real bottleneck for the multi-session/cloud direction. Move decode+diff to a `worker_threads` pool (or at minimum async zlib).

**P2 — `JSON.stringify` snapshot identity check.** See Q4 — same fix.

Otherwise healthy: no N+1-style patterns found, artifact transfers are streamed not buffered, and 17 sync fs calls in the daemon are small JSON/lock files [fact], which is fine.

### 3.6 DevEx & operations

**D1 — Lint and format are not enforced in CI. Medium (and the cheapest fix in this report).**
[fact] `pnpm lint` (`oxlint --deny-warnings`) and oxfmt have zero references in any workflow — `.github/workflows/ci.yml` jobs are: swift-compat, no-test-di-seams, fallow, unit, coverage, typecheck, integration. Verified by grep across `.github/workflows/`.
[judgment] The repo's quality culture clearly assumes lint passes; without the gate, a drive-by PR (or an AI agent) can land warnings and style drift that every later contributor inherits. One small job closes it.

Everything else here is healthy: reproducible setup (`pnpm install` + documented platform prerequisites in `CONTRIBUTING.md`), pinned GitHub Actions by SHA, minimal workflow permissions (`contents: read`), concurrency cancellation, size-report and perf-nightly workflows, and a structured diagnostics system with session-scoped log files and redaction (`src/observability-redaction.ts`, `src/utils/redaction.ts`).

### 3.7 Documentation

Healthy: README is accurate to the code (verified command surface and architecture claims), CONTRIBUTING covers real workflows, `AGENTS.md` documents conventions, hard rules, file map, and testing matrix, and a full docs site lives in `website/`. The only gap worth noting is S3 (auth-hook threat model) and the absence of an ADR-style record for the daemon protocol/versioning strategy — the version+code-signature reuse rule (`src/daemon-client.ts:604-610`) is important behavior documented only in code. **Low.**

### 3.8 Strengths to preserve

1. **Typing discipline:** strict tsconfig + `noUncheckedIndexedAccess` + zero `any` in production.
2. **Dependency posture:** one runtime dependency; custom PNG codec instead of a dep tree.
3. **Security engineering:** loopback bind, per-boot random token (0600), tar/upload hardening, registry-based artifact access, no shell interpolation.
4. **Test architecture:** provider-scenario harness running real handlers, with automated command/flag coverage progress tracking; per-PR emulator smoke + nightly device replays.
5. **Debt visibility:** fallow dead-code is clean and complexity debt is explicitly baselined rather than hidden.
6. **Operational care:** daemon reuse gated on version + code signature; bespoke CI regression guards; AGENTS.md playbook.

---

## 4. Improvement Strategy

**Theme 1 — Decompose the transport/lifecycle monolith (drives A1, T2, part of Q1).**
Target state: `daemon-client.ts` split along its existing seams — lifecycle (discover/spawn/lock), transport (socket/HTTP + fallback + retries), progress streaming, artifact transfer — each behind the current public functions, each directly unit-tested, none over ~600 LOC. Principle: the code that recovers from failure must be the easiest to test, because it runs precisely when things are already going wrong.

**Theme 2 — Make dependencies point inward (drives A2).**
Target state: shared vocabulary (grammar types, flag definitions, app-inventory/perf/log contracts) lives in a layer below both `commands/` and `daemon/` (e.g. `src/contracts/` or `src/core/`); `rg "from '.*commands/" src/daemon src/platforms` returns zero production matches, enforced by a CI guard in the style of the existing `no-test-di-seams` job. Principle: the CLI surface is a *consumer* of the domain, not its home.

**Theme 3 — Put direct tests where the edge cases live (drives T1, enables future platform refactors).**
Target state: the four big untested modules (`ios/apps.ts`, `android/app-lifecycle.ts`, `maestro/runtime-targets.ts`, `client-metro.ts`) have their pure decision logic (parsing, resolution, fallback ordering) extracted into testable functions with fixture-based tests — following the pattern already proven by `runner-xctestrun.test.ts`. Not a coverage-number goal; an edge-case-capture goal.

**Theme 4 — Close the cheap operational gaps (drives D1, S1, S2, P1).**
Target state: CI fails on lint/format; token compares are timing-safe; daemon stays responsive during screenshot work (worker threads). Principle: when hygiene is this good, the remaining gaps are cheap — buy them.

**Explicitly NOT recommending:**
- Splitting `cli-flags.ts` or `dispatch-interactions.ts` — large but cohesive catalogs/handler sets; splitting adds navigation cost without reducing risk.
- Unit tests for `platforms/ios/perf.ts` — specialized, non-critical evidence capture, covered by perf-nightly.
- Reducing mock counts in handler tests (e.g. 47 `vi.mock`s in `session.test.ts`) — the provider-scenario layer already provides the integration confidence; rewriting these is churn.
- Replacing the custom PNG codec with a library — it works, it's tested, and it's the reason the dependency tree is one package.
- Burning down the entire fallow baseline — ratchet it instead (no growth, deliberate paydown tied to Theme 1).

**Definition of done (measurable):**
- CI fails on `oxlint --deny-warnings` and oxfmt check.
- Zero production imports from `src/commands/` in `src/daemon/` + `src/platforms/`, with a CI guard.
- `daemon-client.ts` < 600 LOC; fallow complexity-critical count for the client path: 4 → 0; total health baseline shrunk ≥ 25%.
- Each of the 4 big platform modules has a dedicated test file with ≥ 15 behavior assertions.
- Daemon p95 request latency unaffected by a concurrent screenshot diff (add a perf-nightly scenario to prove it).
- Timing-safe token comparison in both locations.

---

## 5. Task Plan

### Quick wins (do immediately)

| # | Task | Effort | Risk |
| --- | --- | --- | --- |
| QW-1 | Add lint+format job to `ci.yml` | S | Low |
| QW-2 | Timing-safe token comparison (2 sites) | S | Low |
| QW-3 | `chmod 0600` after `daemon.json` write | S | Low |
| QW-4 | CI guard against `commands/` imports in `daemon/`+`platforms/` (warn-only until M2-2 lands) | S | Low |
| QW-5 | Document auth-hook threat model + daemon version/code-signature reuse rule (one docs page) | S | None |
| QW-6 | Clear CVE-2026-9277: add `pnpm.overrides` `"shell-quote": ">=1.8.4"` to `examples/test-app/package.json`, refresh its lockfile | S | Low |

### Milestone 0 — Safety net (before refactoring)

| ID | Task | Files/areas | Acceptance criteria | Effort | Risk | Depends on |
| --- | --- | --- | --- | --- | --- | --- |
| M0-1 | Characterization tests for daemon-client lifecycle: spawn-retry, stale-lock recovery, version/signature mismatch restart, socket→HTTP fallback | `src/daemon-client.ts`, new `src/__tests__/daemon-lifecycle-*.test.ts` | Each named path has a test that fails if behavior changes; runs in unit CI | L | Low (test-only) | — |
| M0-2 | Characterization tests for artifact upload resume/redirect and download abort/cleanup | `daemon-client.ts` (`sendHttpRequest`, `downloadRemoteArtifact`) against a stub `http.Server` | Resume-offset, 5-redirect cap, abort-cleanup each asserted | M | Low | — |
| M0-3 | HTTP-layer edge tests: request cancellation mid-stream, oversized body (1 MiB cap), malformed envelopes | `src/daemon/http-server.ts`, provider-scenario suite | New cases in `daemon-http-server.test.ts`; all green | M | Low | — |

### Milestone 1 — Critical/correctness fixes

| ID | Task | Files/areas | Acceptance criteria | Effort | Risk | Depends on |
| --- | --- | --- | --- | --- | --- | --- |
| M1-1 | QW-1…QW-3 (listed above) | `ci.yml`, `request-router.ts:86`, `http-server.ts:816-823`, `server-lifecycle.ts` | CI red on lint; `timingSafeEqual` with length guard; perms test | S each | Low | — |
| M1-2 | Replace stringify-based snapshot identity with stable presentation hash | `src/commands/snapshot-unchanged.ts:72` + tests | Identical semantics on existing test corpus; TODO removed | M | Medium (semantics subtle — lean on existing `snapshot-unchanged.test.ts`) | — |

(Nothing security-Critical exists; M1 is intentionally small.)

### Milestone 2 — High-leverage improvements

| ID | Task | Files/areas | Acceptance criteria | Effort | Risk | Depends on |
| --- | --- | --- | --- | --- | --- | --- |
| M2-1 | Split `daemon-client.ts` into `daemon-lifecycle.ts`, `daemon-transport.ts`, `daemon-progress.ts` (exists partially as `daemon-client-progress.ts`), `daemon-artifacts.ts` | `src/daemon-client.ts` + new modules; public exports unchanged | All M0 tests green unchanged; file < 600 LOC; fallow client-path criticals 4 → 0; no public API change (`src/index.ts` untouched) | XL — break into 4 PRs, one seam each | Medium | M0-1, M0-2 |
| M2-2 | Extract shared contracts out of `commands/` (grammar types, flag defs used by daemon, `app-inventory-contract`, perf/log contracts) into `src/contracts/` or `src/core/` | ~15 importing files across `daemon/`, `platforms/`, `commands/` | QW-4 guard flipped to error; fallow clean; typecheck green | L | Low-Medium (mostly mechanical moves; watch `verbatimModuleSyntax` type-only imports) | QW-4 |
| M2-3 | Move PNG decode + screenshot diff to a `worker_threads` pool in the daemon | `src/utils/png-codec.ts` callers: `daemon/screenshot-overlay.ts`, `utils/screenshot-diff.ts` | Perf-nightly scenario shows daemon `/health` p95 stable during concurrent diff; results byte-identical on fixture corpus | M | Medium | — |
| M2-4 | Fallow baseline ratchet policy: fail CI if baseline grows; track count in size-report | `fallow-baselines/`, `ci.yml`, `scripts/size-report.mjs` | PR adding a new critical-complexity finding fails CI | S | Low | — |

### Milestone 3 — Quality & polish

| ID | Task | Files/areas | Acceptance criteria | Effort | Risk | Depends on |
| --- | --- | --- | --- | --- | --- | --- |
| M3-1 | Fixture-based tests for `maestro/runtime-targets.ts` (pure parsing/translation — easiest of the four) | `src/compat/maestro/` | ≥ 15 behavior assertions incl. malformed-flow cases | M | Low | — |
| M3-2 | Extract + test decision logic from `android/app-lifecycle.ts` and `ios/apps.ts` (resolution ordering, fallback selection) | `src/platforms/` | Pure functions with fixture tests; provider scenarios unchanged | L each | Medium | M0 pattern |
| M3-3 | Tests for `client-metro.ts` connection/parse logic | `src/client-metro.ts` | Happy path + 3 failure modes asserted | M | Low | — |
| M3-4 | Replace 250 ms+ real sleeps in unit tests with fake timers / condition waits | `src/__tests__/cli-diagnostics.test.ts` et al. | No real sleep > 50 ms in unit project | S | Low | — |
| M3-5 | ADR for daemon protocol & compatibility strategy (transport modes, version/signature reuse, auth hook) | `website/docs/` or `docs/adr/` | Reviewed doc; linked from AGENTS.md | S | None | QW-5 |

### Implementation sketches — top 3 tasks

**M2-1: Split `daemon-client.ts`.**
Approach: extract one seam per PR, in dependency order: (1) artifact transfer (`sendHttpRequest`, `downloadRemoteArtifact`, materialization helpers — most self-contained), (2) progress streaming (merge with existing `daemon-client-progress.ts`), (3) lifecycle (`ensureDaemon`, `startLocalDaemon`, lock/info handling, `isReusableDaemonInfo`), (4) transport selection/retry. Keep `daemon-client.ts` as a façade re-exporting the current public surface so `cli.ts`, MCP, and the `fallow` entry graph see no change. Gotchas: module-level state (cached settings, in-flight daemon-spawn promise) must move carefully — spawn dedup relies on a shared promise; `rslib` bundles `dts`, so confirm `api-extractor`/declaration output is unchanged; update `fallow-baselines/health.json` keys (they're keyed by file) in the same PR or fallow will report both ghosts and new findings.

**M2-2: Contracts extraction.**
Approach: create `src/contracts/` (or extend existing `src/contracts.ts` into a directory) and move, in order of blast radius: `app-inventory-contract.ts` (5 platform importers, types only) → grammar types from `commands/cli-grammar/` used by `daemon/handlers/interaction-touch-targets.ts` → `SCREENSHOT_SPECIFIC_FLAG_DEFINITIONS` (`daemon/context.ts:6`) → perf/log command contracts (`daemon/handlers/session-observability.ts:7-28`) → `react-native/overlay.ts` analysis used by `daemon/screenshot-overlay.ts:10` (this one is logic, not types — likely belongs in `core/`). Leave thin re-exports at old paths for one release to avoid breaking the published subpath exports in `package.json:20-69`. Gotcha: `verbatimModuleSyntax` means every moved type import must stay `import type`; run `pnpm check:tooling` per move.

**QW-1: CI lint gate.**
Approach: add a `lint` job to `.github/workflows/ci.yml` mirroring the `typecheck` job: checkout → `./.github/actions/setup-node-pnpm` → `pnpm lint` → `pnpm exec oxfmt --check <same target list as the format script in package.json:105>`. Run `pnpm lint` and the check locally first; if the tree isn't currently clean, land the format-fix commit separately before the gate. Gotcha: oxfmt's CLI flag for check mode in the pinned version (`^0.42.0`) should be confirmed (`--check` vs `--list-different`); keep the job's target list in sync with the `format` script by referencing it once.

---

## 6. Open Questions (for the maintainers)

1. **Cloud/remote roadmap:** How real is multi-tenant, network-fronted daemon deployment (lease backends, tenant isolation, auth hooks all exist)? If it's near-term, S1/S3 and P1 move up a severity class and Theme 2 becomes urgent; if loopback-only is the contract, they stay Low/Medium.
2. **Maestro compat:** Is `src/compat/maestro/` (1,000+ untested LOC) a strategic surface or a migration bridge? That decides whether M3-1 is worth doing well or the layer should be frozen and minimally maintained.
3. **Performance targets:** Is there a target for snapshot/diff latency under concurrent sessions? Needed to size M2-3 (worker pool vs. simple async zlib) and to make the perf-nightly acceptance criterion concrete.
4. **Fallow baseline intent:** Is the 180-item health baseline meant to trend to zero, or is it an accepted floor for the daemon/dispatch hot paths? Determines whether M2-4's ratchet should also schedule paydown.
5. **`daemon-client.ts` ownership:** Is there appetite for the 4-PR split (M2-1), or is the file considered stable enough that only the safety-net tests (M0) are wanted? Both are defensible; doing M0 without M2-1 still cuts most of the regression risk.
