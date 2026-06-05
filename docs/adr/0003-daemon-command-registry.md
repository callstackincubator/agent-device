# ADR 0003: Daemon Command Registry

## Status

Accepted

## Context

Daemon request handling depends on command traits that are not part of the public command surface:
which handler route owns a command, whether tenant lease admission applies, whether session
execution should lock, whether selector validation applies, whether replay can run an action in the
current session scope, whether invalid recordings block the request, whether Android blocking-dialog
recovery applies, and how request-scoped providers resolve a device.

Those traits used to be spread across `src/command-catalog.ts`, request-policy modules, and
handler-local coverage tables. That made `src/command-catalog.ts` carry daemon-only behavior next
to public command identity, and it required duplicate command sets to stay aligned by convention.

## Decision

Keep public command identity in `src/command-catalog.ts` and public input/output contracts in
`src/commands/**`.

Add `src/daemon/daemon-command-registry.ts` as the daemon-side source of truth for command route
ownership and daemon request-policy traits. Request modules consume predicate functions from the
registry instead of recreating command string sets. Handler modules own execution logic only; they do
not export duplicate coverage tables to prove route membership.

The daemon registry is internal-only. It must not define CLI grammar, Node.js client options, MCP
schemas, user-facing help, or platform capability support. Those remain owned by the command
contract, projection, help, and capability modules.

## Alternatives Considered

- Keep daemon groups in `src/command-catalog.ts`: this keeps one command-name file, but it mixes
  public command identity with daemon runtime policy and makes the catalog grow for internal-only
  routing decisions.
- Keep handler-local coverage tables: this makes each handler self-describing, but creates a second
  route membership source that can drift from the router and request-policy modules.
- Put route checks directly in request modules: this is locally simple, but scatters command
  classification across admission, locking, provider scoping, replay, recording, and generic
  dispatch.

## Consequences

Adding or moving a daemon-handled command requires updating the daemon command registry with its
route and request-policy traits. The registry tests pin the trait decisions, while provider-backed
integration scenarios verify important request-policy behavior through the real daemon request path.

The registry file is intentionally a dense internal contract. Its interface should stay small:
callers ask daemon-policy questions through named predicates rather than reading or mutating command
sets.

`AGENTS.md` should contain only the operating rule and relevant file pointers for agents. This ADR
owns the rationale so future changes do not need to infer it from agent instructions.
