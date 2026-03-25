# Verification

## When to open this file

Open this file when the task needs evidence, regression checks, replay maintenance, or startup performance measurements after the main interaction flow is already working.

## Main commands to reach for first

- `screenshot`
- `diff snapshot`
- `record`
- `replay -u`
- `perf`

## Most common mistake to avoid

Do not use verification tools as the first exploration step. First get the app into the correct state with the normal interaction flow, then capture proof or maintain replay assets.

## Canonical loop

```bash
agent-device open Settings --platform ios
agent-device snapshot -i
agent-device press @e5
agent-device diff snapshot -i
agent-device screenshot /tmp/settings-proof.png
agent-device close
```

## Structural verification with diff snapshot

Use `diff snapshot` when you need a compact view of how the UI changed between nearby states.

```bash
agent-device snapshot -i
agent-device press @e5
agent-device diff snapshot -i
```

- Initialize the baseline at a stable point.
- Perform the mutation.
- Run `diff snapshot` to confirm the expected structural change.
- Re-run full `snapshot` only when you need fresh refs.

## Visual artifacts

Use `screenshot` when the proof needs a rendered image instead of a structural tree.

## Session recording

Use `record` for debugging, documentation, or shareable verification artifacts.

```bash
agent-device record start ./recordings/ios.mov
agent-device open App
agent-device snapshot -i
agent-device press @e3
agent-device close
agent-device record stop
```

- `record` supports iOS simulators, iOS devices, and Android.
- Recording writes a video artifact and a gesture-telemetry sidecar JSON.
- On macOS hosts, touch overlay burn-in is available for supported recordings.
- If the agent already knows the interaction sequence and wants a more lifelike, uninterrupted recording, drive the flow with `batch` while recording instead of replanning between each step.

Example:

```bash
agent-device record start ./recordings/smoke.mov
agent-device batch --session sim --platform ios --steps-file /tmp/smoke-steps.json --json
agent-device record stop
```

- Use this only after exploration has stabilized the flow.
- Keep the batch short and add `wait` or `is exists` guards after mutating steps so the recorded flow still tracks realistic UI timing.

## Replay maintenance

Use replay updates when selectors drift but the recorded scenario is still correct.

```bash
agent-device replay -u ./session.ad
```

- Prefer selector-based actions in recorded `.ad` replays.
- Use update mode for maintenance, not as a substitute for fixing a broken interaction strategy.

## Performance checks

Use `perf --json` or `metrics --json` when you need startup timing for the active session.

```bash
agent-device open Settings --platform ios
agent-device perf --json
```

- Current startup data is command round-trip timing around `open`.
- It is not true first-frame or first-interactive telemetry.
- `fps`, `memory`, and `cpu` are currently placeholders.
