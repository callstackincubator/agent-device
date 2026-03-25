# Video Recording

Capture device automation sessions as video for debugging, documentation, or verification

## iOS Simulator

Use `agent-device record` commands (wrapper around simctl):

```bash
# Start recording
agent-device record start ./recordings/ios.mov

# Perform actions
agent-device open App
agent-device snapshot -i
agent-device click @e3
agent-device close

# Stop recording
agent-device record stop
```

`record` supports iOS simulators, physical iOS devices, and Android.

Recording outputs:

- a video artifact
- a gesture-telemetry sidecar JSON next to the video

Touch overlay support:

- macOS host: telemetry can be burned into the video as visible touch overlays
- non-macOS host: recording still succeeds, but the video stays raw and `record stop` returns an `overlayWarning`

## Android Emulator/Device

Use `agent-device record` commands (wrapper around adb):

```bash
# Start recording
agent-device record start ./recordings/android.mp4

# Perform actions
agent-device open App
agent-device snapshot -i
agent-device click @e3
agent-device close

# Stop recording
agent-device record stop
```
