# Verification

## When to open this file

Open this file when the task needs evidence, regression checks, replay maintenance, or session performance measurements after the main interaction flow is already working.

## Main commands to reach for first

- `screenshot`
- `diff snapshot`
- `diff screenshot`
- `diff frames`
- `diff video`
- `record`
- `replay -u`
- `perf`

## Most common mistake to avoid

Do not use verification tools as the first exploration step. First get the app into the correct state with the normal interaction flow, then capture proof or maintain replay assets.

## Canonical loop

```bash
agent-device open Settings --platform ios
# after using exploration to reach the state you want to verify
agent-device snapshot
agent-device screenshot /tmp/settings-proof.png --overlay-refs
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

## Screenshot artifacts

Use `screenshot` when the proof needs a rendered image instead of a structural tree.

- Add `--overlay-refs` when you want the saved PNG to show fresh `@eN` refs burned into the screenshot.

## Visual regression with diff screenshot

Use `diff screenshot` when comparing the current rendered screen against a saved visual baseline.

```bash
agent-device diff screenshot --baseline ./baseline.png --out /tmp/diff.png
agent-device diff screenshot --baseline ./baseline.png ./current.png --out /tmp/diff.png
agent-device diff screenshot --baseline ./baseline.png --out /tmp/diff.png --overlay-refs
```

- Text output includes ranked changed regions with screen-space rectangles, shape, size, density, average color, and luminance. JSON also includes normalized bounds.
- The diff PNG uses a light grayscale current-screen context with changed pixels tinted red and changed regions outlined.
- When a current image path is provided, `diff screenshot` compares the two saved files instead of capturing from the live device or requiring an active session.
- Install `tesseract` when you want `diff screenshot` to add best-effort OCR text deltas, movement clusters, and bbox size-change hints. OCR improves the text/JSON descriptions only; it does not change the pixel comparison or the diff PNG.
- When OCR is available, `diff screenshot` also reports best-effort non-text visual deltas by masking OCR text boxes out of the pixel diff and clustering the remaining residuals. Treat these as hints for icons, controls, and separators, not semantic icon recognition.
- Add `--overlay-refs` to `diff screenshot` when you also want a separate current-screen overlay guide for a live capture. The raw screenshot is still used for pixel comparison; the overlay guide is only context for non-text controls, icons, and tappable regions. When overlay refs intersect changed regions, the output lists the best current-screen ref matches under the affected region. Saved-image comparisons do not have live accessibility refs, so omit `--overlay-refs` when passing a current image path.

## Transition summaries with diff frames/video

Use `diff frames` or `diff video` when a screenshot pair is too static and you need a compact timeline for a transition, animation, or recorded interaction.

```bash
agent-device diff frames ./frames --out /tmp/settings-transition
agent-device diff frames ./frame-001.png ./frame-002.png ./frame-003.png --out /tmp/settings-transition
agent-device diff video ./recordings/settings.mov --out /tmp/settings-transition --telemetry ./recordings/settings.gesture-telemetry.json
agent-device diff video ./recordings/settings.mov --sample-fps 8 --max-frames 120 --json
```

- `diff frames` accepts a directory of PNG frames or explicit PNG paths. It works without external video tools. Use `--frame-interval-ms <n>` when recording telemetry timestamps need to line up with a known frame cadence; otherwise frames are spaced at `100ms`.
- `diff video` requires `ffmpeg` and `ffprobe` in `PATH`; it samples the recording into PNG frames, then runs the same transition summarizer.
- Add `--telemetry <path>` with a recording gesture sidecar when available. The output can then anchor transitions to events such as `after tap` or `during up scroll`.
- The text output stays capped to the top transitions, keyframes, changed-region summaries, and optional OCR movement hints. Use `--json` when you need the structured metrics.
- Install `tesseract` for OCR movement hints on selected transition boundaries. OCR is optional and is not run for every sampled frame.

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
- On iOS, recording is a wrapper around `simctl` for simulators and the corresponding device capture path for physical devices.
- On Android, recording is a wrapper around `adb`.
- Recording writes a video artifact and a gesture-telemetry sidecar JSON.
- Use `record start <path> --quality 5` when a smaller video is easier to inspect or share. The scale is 5-10, where 10 is native resolution; omit it to preserve native/current resolution.
- On macOS hosts, touch overlay burn-in is available for supported recordings.
- On non-macOS hosts, recording still succeeds but the video stays raw and `record stop` can return an `overlayWarning`.
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
agent-device test ./smoke --platform android
```

- Prefer selector-based actions in recorded `.ad` replays.
- Use `test` when you already have multiple `.ad` flows and need a quick regression pass after updating or recording them.
- Keep the skill-level rule simple: use `replay -u` to maintain one script, use `test` to verify a folder or matcher of scripts.
- Treat `test` as a human and CI-facing suite runner that an agent can invoke for verification, not as the main source of product documentation.
- Failed runs keep suite artifacts under `.agent-device/test-artifacts` by default, which is usually enough for debugging without extra agent-side processing.
- Use update mode for maintenance, not as a substitute for fixing a broken interaction strategy.

## Performance checks

Use `perf --json` or `metrics --json` when you need session performance data for the active session.

```bash
agent-device open Settings --platform ios
agent-device perf --json
```

- `startup` is command round-trip timing around `open`.
- It is not true first-frame or first-interactive telemetry.
- Android app sessions also expose `memory` (`dumpsys meminfo`) and `cpu` (`dumpsys cpuinfo`) snapshots when the session has an app package context.
- Apple app sessions on macOS and iOS simulators also expose `memory` and `cpu` process snapshots when the session has an app bundle ID.
- `fps` is still unavailable, and physical iOS devices still leave `memory` and `cpu` unavailable in this release.
