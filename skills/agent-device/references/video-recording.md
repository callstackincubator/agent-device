# Video Recording

Capture device automation sessions as video for debugging, documentation, or verification

## iOS Simulator / Device

Use `agent-device record` commands:

```bash
# Start recording
agent-device record start ./recordings/ios.mp4
agent-device record start ./recordings/ios.mp4 --hide-touches

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
- Touch overlays are enabled by default for iOS recordings.
- Use `--hide-touches` to disable overlays for a single recording.

## Android Emulator/Device

Use `agent-device record` commands (wrapper around adb):

```bash
# Start recording
agent-device record start ./recordings/android.mp4
agent-device record start ./recordings/android.mp4 --hide-touches

# Perform actions
agent-device open App
agent-device snapshot -i
agent-device click @e3
agent-device close

# Stop recording
agent-device record stop
```

- Touch indicators are enabled by default for Android recordings and restored on `record stop`.
- Use `--hide-touches` to disable them for a single recording.
