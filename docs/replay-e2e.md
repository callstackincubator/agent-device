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

By default, on `close`, a replay script is written to:

```text
~/.agent-device/sessions/<session>-<timestamp>.ad
```

You can also provide a custom output file path:

```bash
agent-device open Settings --platform ios --session e2e --save-script ./workflows/e2e-settings.ad
```

- `--save-script` value is treated as a file path.
- Parent directories are created automatically when they do not exist.
- For ambiguous bare values, use `--save-script=workflow.ad` or a path-like value such as `./workflow.ad`.

## Run replay

```bash
agent-device replay ~/.agent-device/sessions/e2e-2026-02-09T12-00-00-000Z.ad --session e2e-run
```

- Replay reads `.ad` scripts.

## Run a lightweight `.ad` suite

```bash
agent-device test ./workflows
agent-device test "./workflows/**/*.ad" --platform android
agent-device test ./workflows --timeout 60000 --retries 1
agent-device test ./workflows --artifacts-dir ./tmp/agent-device-artifacts
```

- `test` discovers `.ad` files from files, directories, or globs and runs them serially.
- `context platform=...` inside each `.ad` file is the target source of truth for suite execution.
- `--platform` is a filter for suite discovery; files without platform metadata are skipped when a filter is present.
- `context timeout=...` and `context retries=...` can be declared per script; CLI flags override metadata. Retries are capped at `3`, and duplicate keys in the context header fail fast instead of silently overriding each other.
- By default, suite artifacts are written under `.agent-device/test-artifacts/<run-id>/...`. Each attempt writes `replay.ad` and `result.txt`; failed attempts also keep copied logs and artifact files when the replay produced them.
- Timeouts are cooperative: the runner marks the attempt failed at the timeout boundary, then gives the underlying replay a short grace period to stop before session cleanup.
- The default text reporter prints the suite summary, failed tests, and passed-on-retry flaky tests; use `--verbose` to print every test result.
- When `--fail-fast` and retries are both set, the current test still consumes its retries before the suite stops.

## Parametrise `.ad` scripts

Substitute `${VAR}` tokens in `.ad` scripts using values from the CLI, shell env, script-local `env` directives, or built-ins.

```sh
context platform=android
env APP_ID=settings
env WAIT_SHORT=500

open ${APP_ID} --relaunch
wait ${WAIT_SHORT}
click "label=${APP_ID}"
```

### Precedence

| Source                       | Priority | Example                                                                 |
| ---------------------------- | -------- | ----------------------------------------------------------------------- |
| CLI `-e KEY=VALUE`           | highest  | `agent-device test flow.ad -e APP_ID=demo`                              |
| Shell env prefixed `AD_VAR_` |          | `AD_VAR_APP_ID=demo agent-device test flow.ad` (imported as `APP_ID`)   |
| Script `env KEY=VALUE`       |          | `env APP_ID=settings` in header                                         |
| Built-ins                    | runtime  | `AD_PLATFORM`, `AD_SESSION`, `AD_FILENAME`, `AD_DEVICE`, `AD_ARTIFACTS` |

### Built-ins

Built-ins are provided by replay/test runtime and use the reserved `AD_*` namespace.

- `AD_PLATFORM` - matches `context platform=...` or the selected platform when available
- `AD_SESSION` - active session name
- `AD_FILENAME` - path of the running `.ad` file
- `AD_DEVICE` - device identifier (when `--device` is set)
- `AD_ARTIFACTS` - attempt artifacts directory (when running under `test`)

User-defined keys starting with `AD_` are rejected in `env`, `-e`, and shell imports such as `AD_VAR_AD_FOO`, so built-ins cannot be overridden.

Substitution happens inside parsed string values. It does not create extra arguments, so quote selectors or text values that contain spaces:

```sh
env SETTINGS="label=Account || label=Profile"
click "${SETTINGS}"
```

### Fallback and escape

```sh
wait ${WAIT_MS:-500}
```

`${VAR:-default}` yields `default` when `VAR` is unset.

```sh
echo "Price: \${APP}"
```

`\${APP}` emits a literal `${APP}` with no substitution.

### Recipes

Run one flow against two app variants in CI:

```sh
agent-device test ./flows/login.ad -e APP_ID=com.example.debug
agent-device test ./flows/login.ad -e APP_ID=com.example.release
```

Tune timings locally without editing the script:

```sh
AD_VAR_WAIT_SHORT=2000 agent-device replay ./flow.ad
```

Extract a reusable selector. Before:

```sh
click "label=Account || label=Profile || label=User"
wait 500
click "label=Account || label=Profile || label=User"
```

After:

```sh
env SETTINGS="label=Account || label=Profile || label=User"

click "${SETTINGS}"
wait 500
click "${SETTINGS}"
```

Quote `${VAR}` inside selector expressions so the whole expression is treated as a single argument.

### Notes

- `replay -u` does not yet preserve `env` directives or `${VAR}` tokens. Workaround: temporarily inline the literal values, run `-u`, re-parametrise.
- Shell env (`AD_VAR_*`) is collected on the CLI/client side at request time, so the same values are seen whether the daemon runs locally or remotely.
- No nested fallback. `${A:-${B}}` is not supported.
- Unresolved `${VAR}` fails with a `file:line` reference. Typos are loud.

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
