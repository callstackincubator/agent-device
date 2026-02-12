# Replay & E2E Testing (Experimental)

Agents use refs for exploration and authoring. Replay scripts are deterministic runs that can be used for E2E testing.

## Core model

Two-pass workflow:

1. Agent pass: discover and interact with refs (`snapshot` -> `click @e..` / `fill @e..`).
2. Deterministic pass: run recorded `.ad` script with `replay`.

## Record a replay script

Enable recording during a session:

```bash
agent-device open Settings --platform ios --session e2e --save-script
agent-device snapshot -i --session e2e
agent-device click @e13 --session e2e
agent-device close --session e2e
```

On `close`, a replay script is written to:

```text
~/.agent-device/sessions/<session>-<timestamp>.ad
```

## Run replay

```bash
agent-device replay ~/.agent-device/sessions/e2e-2026-02-09T12-00-00-000Z.ad --session e2e-run
```

- Replay reads `.ad` scripts.

## Update stale selectors in replay scripts

```bash
agent-device replay -u ~/.agent-device/sessions/e2e-2026-02-09T12-00-00-000Z.ad --session e2e-run
```

When a replay step fails, update can:

- Take a fresh snapshot.
- Resolve a stable replacement target.
- Retry the step.
- Rewrite the failing line in the same `.ad` file.

Current update targets:

- `click`
- `fill`
- `get`
- `is`
- `wait`

## `replay -u` before/after examples

Example 1: stale selector rewritten in place

```sh
# Before
click "id=\"old_continue\" || label=\"Continue\""

# After `replay -u`
click "id=\"auth_continue\" || label=\"Continue\""
```

Example 2: stale ref-based action upgraded to selector form

```sh
# Before
snapshot -i -c -s "Continue"
click @e13 "Continue"

# After `replay -u`
snapshot -i -c -s "Continue"
click "id=\"auth_continue\" || label=\"Continue\""
```

Use `replay -u` locally during maintenance, review the rewritten `.ad` lines, then commit the updated script.

## Troubleshooting

- Replay fails after UI/layout changes:
  - Run `replay -u` locally and review the rewritten lines.
- Updating cannot resolve a unique target:
  - Re-record that flow (`--save-script`) from a fresh exploratory pass.
- Replay file parse error:
  - Validate quoting in `.ad` lines (unclosed quotes are rejected).
