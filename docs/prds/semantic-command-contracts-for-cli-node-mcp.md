# Semantic Command Contracts for CLI, Node.js, and MCP

## Problem Statement

`agent-device` exposes the same public command surface through three automation interfaces: CLI commands, the Node.js client API, and MCP tools. MCP should be treated as a first-class semantic tool interface, not as a handoff screen or CLI-shaped router.

The CLI owns most of the positional grammar, flag parsing, human help, and command handler wiring. The Node.js API exposes typed methods over the daemon request path. Several building blocks for a semantic command contract already exist: typed command option interfaces, command codecs, target parsing, command capabilities, an underused command definition type, and generic CLI handlers that map decoded inputs into client methods.

From a user and maintainer perspective, this creates three related problems:

- MCP users cannot use `agent-device` automation as first-class structured tools from clients such as Claude Code in VS Code or Cursor.
- Adding or changing a command requires keeping CLI parsing, Node.js method options, MCP schema, help text, and daemon request wiring aligned manually.
- Existing command contract pieces are split across command schemas, codecs, CLI handlers, and client methods rather than consolidated into a single registry.

The goal is to consolidate the existing pieces so CLI, Node.js, and MCP share roughly the same command definition while preserving CLI compatibility and keeping the daemon/client request path as the source of execution truth.

## Solution

Introduce semantic command contracts as the source of truth for public command inputs and outputs. A command definition should describe the command itself: name, description, semantic input contract, result contract where useful, command capability, and execution through `AgentDeviceClient`.

MCP and Node.js should consume semantic, object-shaped inputs generated from the same command contract. CLI should remain the compatibility adapter that converts argv tokens into the same semantic input. Default CLI usage should be generated from the semantic input where possible. Legacy compact positional grammar should be handled by command-specific CLI normalizers outside the command definition. Human CLI rendering should stay separate from command definitions. Daemon handlers, platform modules, provider seams, session state, admission, locking, and dispatch should continue to run through the existing client/daemon path.

The implementation should converge on typed semantic definitions for every public command name, MCP execution through `AgentDeviceClient` for client-backed automation, and explicit local-only boundaries for workflows that are not device automation commands.

The first implementation slice should prove that the existing TypeScript option/result types and command codecs can carry most of the contract. A broader semantic schema DSL should only be introduced where existing types, codecs, and minimal metadata cannot express semantic inputs and outputs cleanly.

The current implementation migrates the public command surface to semantic MCP tools without a CLI subprocess fallback. Client-backed commands execute through `AgentDeviceClient`. Generic and dedicated CLI handlers normalize legacy argv/flags into the same semantic input and call the same semantic command runner where the command is client-backed; existing command codecs remain as CLI normalizers where they preserve current grammar. Local-only workflows such as auth, connect, connection, disconnect, and react-devtools are represented as explicit semantic boundaries rather than subprocess-backed MCP tools.

## User Stories

1. As a Claude Code user in VS Code, I want `agent-device` MCP tools to expose structured inputs, so that I can use app automation without switching to terminal-shaped workflows.
2. As a Cursor user, I want MCP tools for every supported command, so that I can discover and invoke device workflows from the agent panel.
3. As an AI agent, I want a `click` tool with a typed target field, so that I do not need to infer whether `@e12`, `label="Submit"`, or `100 200` is valid positional syntax.
4. As an AI agent, I want a `fill` tool with explicit `target` and `text` fields, so that I avoid malformed command strings.
5. As an AI agent, I want a `wait` tool with explicit wait modes, so that duration, text, ref, and selector waits are unambiguous.
6. As an AI agent, I want `snapshot` inputs to use semantic names such as `interactiveOnly`, `scope`, and `forceFull`, so that MCP matches the Node.js API rather than CLI aliases.
7. As an AI agent, I want MCP result payloads to be the same structured command results as the Node.js client sees, so that I can reason over nodes, refs, diagnostics, and artifacts.
8. As a CLI user, I want existing commands and flags to keep working, so that this refactor does not break scripts or agent instructions.
9. As a CLI user, I want help output to stay accurate, so that command usage remains version-matched with installed behavior.
10. As a Node.js API user, I want typed client methods to remain ergonomic, so that I do not need to construct CLI argv to use `agent-device`.
11. As a maintainer, I want one command contract per command, so that command shape changes do not require unrelated updates across CLI, MCP, and Node.js.
12. As a maintainer, I want CLI positionals to be generated from or normalized into semantic fields, so that positional parsing becomes reusable and less error-prone.
13. As a maintainer, I want target parsing to be reusable across `click`, `press`, `longpress`, `fill`, and related interactions, so that target behavior is consistent.
14. As a maintainer, I want selector snapshot options to be shared across selector-based commands, so that `depth`, `scope`, and `raw` behavior stays coherent.
15. As a maintainer, I want command capabilities to remain centralized, so that supported target behavior is not duplicated across interfaces.
16. As a maintainer, I want daemon request construction to continue through `AgentDeviceClient`, so that MCP does not become a parallel execution engine.
17. As a maintainer, I want human CLI output rendering outside semantic command contracts, so that command definitions stay focused on inputs and execution.
18. As a maintainer, I want migrated commands to support in-process MCP execution, so that MCP avoids an unnecessary subprocess hop.
19. As a maintainer, I want local-only commands to have an explicit MCP boundary, so that clients do not mistake them for generic shell execution.
20. As a maintainer, I want adding a new public command to fail coverage until its semantic/MCP decision is explicit, so that MCP parity cannot silently regress.
21. As a maintainer, I want provider-backed integration scenarios to remain the behavioral validation path for daemon workflows, so that tests exercise the public daemon path.
22. As a maintainer, I want command codecs to evolve into semantic token binders where useful, so that existing parsing investment is reused instead of replaced wholesale.
23. As a maintainer, I want CLI parse modes such as pass-through arguments and variadic text to be explicit per command, so that special cases do not leak into global parser behavior.
24. As a maintainer, I want schema primitives to stay small, so that the repo does not grow a general-purpose CLI framework.
25. As a documentation author, I want the docs to describe MCP as semantic-tool-backed, so that users understand the source of truth.
26. As a maintainer, I want existing codecs and command option types reused before new schema primitives are introduced, so that this project consolidates rather than duplicates command contracts.
27. As a maintainer, I want migrated command result contracts to be visible to MCP clients where practical, so that agents understand important fields in structured results.
28. As a maintainer, I want the generic CLI handler and router code to shrink as commands migrate, so that the refactor removes code instead of adding a permanent layer.
29. As a maintainer, I want command definitions to be interface-neutral, so that `defineCommand` does not accumulate CLI, MCP, and Node-specific subcontracts.
30. As a maintainer, I want CLI adapters to be separate from command definitions, so that legacy argv compatibility does not distort the semantic command model.

## Implementation Decisions

- Add a semantic command definition registry that extends the current command definition concept rather than introducing a second unrelated registry.
- Treat the work as consolidation. The registry should connect existing command definitions, command codecs, typed client option/result types, command capabilities, and client method bindings.
- Keep `defineCommand` interface-neutral. It should contain command identity, semantic input contract, result contract metadata where useful, capability, and `run(client, input)`.
- Do not put permanent `mcp`, `codec`, or `cli` blocks on the core command definition. Interface adapters may reference a command definition, but the command definition should not be shaped around adapter needs.
- Keep `AgentDeviceClient` as the execution boundary. Command definitions may call typed client methods, but they must not bypass client normalization, daemon request construction, request admission, locking, session state, handler routing, or platform dispatch.
- MCP should run as its own stdio server process and create an `AgentDeviceClient` using the existing daemon transport. It should not run inside the daemon process or call daemon handlers directly.
- Keep command capabilities attached to command definitions and continue deriving centralized capability maps from those definitions.
- Replace string-only positional metadata over time with semantic input fields and CLI adapters that normalize argv tokens into those fields.
- Generate default CLI usage and argument binding from semantic input where the grammar is straightforward.
- Add separate CLI normalizers only where existing CLI grammar cannot be derived from semantic input, such as overloaded targets, literal subcommands, variadic text, value-setting flags, or compact gesture forms.
- Start with a thin semantic metadata layer using existing TypeScript option/result types and codecs as the source. Introduce reusable schema primitives only when the first migrated command family proves that metadata plus existing codecs are insufficient.
- Generate MCP JSON schemas from semantic command inputs for migrated commands. MCP inputs should be semantic and object-shaped, not CLI-shaped `positionals + flags`.
- Result types are part of the command contract. MCP should return the same structured result objects produced by `AgentDeviceClient` for migrated commands. Output schemas may start broad, but high-value commands such as snapshot, find, get, screenshot, logs, and perf should gain useful result schema metadata over time.
- Keep CLI parsing as a two-phase process: first lex argv into option and positional tokens, then bind those tokens to the semantic input using generated defaults or command-specific normalizers.
- Learn from Commander-style declarative arguments, Node `parseArgs` token separation, `arg`-style small specs, and yargs-style explicit parse modes, but do not add a third-party dependency.
- Model reusable CLI normalizers such as target, point, enum, integer, JSON object, literal token, optional value, variadic rest text, and `oneOf` variants outside core command definitions.
- Model CLI flags as semantic field aliases in the CLI adapter layer. Value-setting aliases such as `--system` and `--in-app` should set semantic fields directly.
- Preserve legacy CLI usage for existing commands. The semantic input layer must adapt from current argv syntax rather than require users to learn a new CLI grammar.
- Keep human output rendering in CLI modules. Command definitions may return structured results, but CLI renderers decide human text.
- MCP should expose typed tools for every public command name except the MCP transport command itself. Commands that are local-only should be explicit semantic boundaries, not subprocess fallbacks.
- Command exposure coverage should fail when a public command lacks a semantic definition.
- Keep future command additions on the semantic contract path from the start, with CLI normalizers only where existing argv grammar requires them.
- Do not add a CLI-backed MCP subprocess bridge. MCP is a semantic tool interface backed by `AgentDeviceClient`.
- Do not generate command schemas directly from TypeScript types in the first implementation slice. Prefer existing codecs plus small hand-authored metadata colocated with command definitions and checked by TypeScript with `satisfies` where practical.
- Avoid a big-bang rewrite of all CLI handlers. Extract pure command runners and semantic binders command family by command family.
- As command families migrate, remove or shrink the corresponding hand-written CLI dispatch code. The target state is that the generic CLI handler and router mostly perform registry lookup, semantic input binding, client execution, and CLI rendering.
- Existing command-codec modules should not be discarded wholesale. They should either remain as reusable CLI adapter modules or be absorbed into colocated adapter modules when doing so clearly reduces indirection.
- Keep deep modules small and testable. Candidate deep modules are semantic input schema builders, argv tokenization, CLI token binding, MCP schema projection, and command coverage validation.

## Testing Decisions

- Tests should verify external behavior and command contracts rather than implementation details.
- Add unit tests for the argv tokenizer. Good tests cover `--`, long flags, short aliases where supported, inline `--flag=value`, repeated flags, unknown option modes, and positional token order.
- Add unit tests for semantic CLI normalizers. Good tests cover generated default binding, target parsing, point targets, selector targets, ref targets, rest text, optional arguments, variant selection, and malformed mixed forms.
- Add unit tests for MCP schema projection on migrated commands. Good tests verify that schemas expose semantic object fields rather than CLI-shaped `positionals + flags`.
- Keep a coverage test asserting that every public command has a semantic MCP definition.
- Add focused tests for high-value migrated command families before removing old command-family CLI parsing.
- Add focused tests for result contracts on high-value migrated commands. Good tests verify that MCP returns the structured `AgentDeviceClient` result without losing identifiers, diagnostics, artifacts, or important command-specific fields.
- Use provider-backed integration scenarios for behavior that must exercise the public daemon path. This follows the accepted provider-first integration ADR: broad scenarios should preserve request admission, locking, session state, handler routing, dispatch, platform modules, and provider seams.
- Keep HTTP contract tests narrow. MCP and CLI adapter tests should not replace daemon JSON-RPC transport, auth, and response finalization tests.
- Avoid tests that assert TypeScript-only shapes at runtime when TypeScript can enforce the contract.
- Existing parser and args tests are prior art for CLI usage and help behavior.
- Existing MCP router tests are prior art for command exposure coverage.
- Existing command-codec tests, selector tests, handler tests, and provider-backed integration tests are prior art for migrated command families.

## Out of Scope

- Replacing the daemon request path, daemon handlers, platform modules, provider seams, or session store behavior.
- Changing public CLI grammar except where a compatibility-preserving bug fix is explicitly required.
- Adding a third-party CLI parser dependency such as Commander, yargs, or arg.
- Building a general-purpose CLI framework beyond the primitives needed by `agent-device`.
- Publishing this PRD to GitHub Issues.
- Updating skills to duplicate command behavior. Skills should continue routing to versioned CLI help unless explicitly requested.
- Replacing unrelated daemon request routing, handler, or platform architecture.
- Reintroducing a CLI-shaped MCP fallback after semantic coverage is complete.
- Generating semantic command contracts automatically from TypeScript declarations.
- Replacing all existing command-codec files purely for symmetry.
- Running MCP inside the daemon process.

## Further Notes

- This PRD intentionally treats CLI positionals as generated syntax or adapter-normalized syntax for semantic command input, not as the command contract itself.
- The codebase already has much of the foundation: typed command options, command codecs for several families, shared target parsing, centralized capabilities, a command definition type, and generic CLI handlers. The work should consolidate these pieces before adding new abstraction surface.
- The most important architectural guardrail is that command definitions must not become a second execution engine. They should describe and bind command inputs, then call `AgentDeviceClient`.
- The first implementation slice proves the pattern on one simple command (`boot`), core interaction commands (`click`, `press`, `fill`), one complex subcommand-style gesture (`gesture transform`), and structured `batch` input. Interaction commands are still the strongest next migration area because target parsing is important and reusable.
- The second implementation slice should migrate selector and snapshot commands because they are central to the agent loop: open, snapshot, act, re-snapshot, verify, close.
- Docs should explain the completed state clearly: MCP exposes semantic tools backed by the client; local-only workflows are explicit boundaries and MCP is not a generic shell runner.
