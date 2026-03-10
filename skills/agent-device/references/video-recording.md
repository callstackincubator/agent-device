# Video Recording

Capture device automation sessions as video for debugging, documentation, or verification

## iOS Simulator / Device

Use `agent-device record` commands:

```bash
# Start recording
agent-device record start ./recordings/ios.mp4
agent-device record start ./recordings/ios.mp4 --show-touches

# Perform actions
agent-device open App
agent-device snapshot -i
agent-device click @e3
agent-device close

# Stop recording
agent-device record stop
```

- iOS simulators use `simctl io ... recordVideo`.
- iOS physical devices use runner screenshot capture stitched into MP4.
- `--show-touches` burns agent-driven taps and gestures into the exported iOS video during `record stop`.

## Android Emulator/Device

Use `agent-device record` commands (wrapper around adb):

```bash
# Start recording
agent-device record start ./recordings/android.mp4
agent-device record start ./recordings/android.mp4 --show-touches

# Perform actions
agent-device open App
agent-device snapshot -i
agent-device click @e3
agent-device close

# Stop recording
agent-device record stop
```

- `--show-touches` temporarily enables the system tap indicator while recording and restores the previous setting on `record stop`.
