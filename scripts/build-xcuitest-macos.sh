#!/bin/sh
set -eu

DERIVED_PATH="${AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH:-$HOME/.agent-device/ios-runner/derived/macos}"

# macOS runner builds default to incremental reuse for faster local iteration.
# Set AGENT_DEVICE_IOS_CLEAN_DERIVED=1 to force a clean rebuild when DerivedData gets stale.
# This is intentionally narrower than build:xcuitest:ios, which keeps its existing clean-first behavior.
case "${AGENT_DEVICE_IOS_CLEAN_DERIVED:-}" in
  1|true|TRUE|yes|YES|on|ON)
    rm -rf "$DERIVED_PATH"
    ;;
esac

xcodebuild build-for-testing \
  -project ios-runner/AgentDeviceRunner/AgentDeviceRunner.xcodeproj \
  -scheme AgentDeviceRunner \
  -destination "platform=macOS,arch=$(uname -m)" \
  -derivedDataPath "$DERIVED_PATH" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  DEVELOPMENT_TEAM="" \
  COMPILER_INDEX_STORE_ENABLE=NO \
  ENABLE_CODE_COVERAGE=NO
