#!/bin/sh
set -eu

PLATFORM="${AGENT_DEVICE_XCUITEST_PLATFORM:-}"
PROJECT_PATH="ios-runner/AgentDeviceRunner/AgentDeviceRunner.xcodeproj"
SCHEME="AgentDeviceRunner"

if [ -z "$PLATFORM" ]; then
  echo "AGENT_DEVICE_XCUITEST_PLATFORM is required (ios, macos, tvos)" >&2
  exit 1
fi

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

resolve_default_destination() {
  case "$PLATFORM" in
    ios)
      printf '%s\n' 'generic/platform=iOS Simulator'
      ;;
    macos)
      printf 'platform=macOS,arch=%s\n' "$(uname -m)"
      ;;
    tvos)
      printf '%s\n' 'generic/platform=tvOS Simulator'
      ;;
    *)
      echo "Unsupported AGENT_DEVICE_XCUITEST_PLATFORM: $PLATFORM" >&2
      exit 1
      ;;
  esac
}

resolve_default_derived_path() {
  case "$PLATFORM" in
    ios)
      printf '%s\n' "$HOME/.agent-device/ios-runner/derived"
      ;;
    macos)
      printf '%s\n' "$HOME/.agent-device/ios-runner/derived/macos"
      ;;
    tvos)
      printf '%s\n' "$HOME/.agent-device/ios-runner/derived/tvos"
      ;;
    *)
      echo "Unsupported AGENT_DEVICE_XCUITEST_PLATFORM: $PLATFORM" >&2
      exit 1
      ;;
  esac
}

resolve_clean_path() {
  if [ -n "${AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH:-}" ]; then
    printf '%s\n' "$DERIVED_PATH"
    return
  fi

  case "$PLATFORM" in
    ios)
      printf '%s\n' "$DERIVED_PATH/device"
      ;;
    macos|tvos)
      printf '%s\n' "$DERIVED_PATH"
      ;;
    *)
      echo "Unsupported AGENT_DEVICE_XCUITEST_PLATFORM: $PLATFORM" >&2
      exit 1
      ;;
  esac
}

should_clean_by_default() {
  case "$PLATFORM" in
    ios|tvos)
      return 0
      ;;
    macos)
      return 1
      ;;
    *)
      echo "Unsupported AGENT_DEVICE_XCUITEST_PLATFORM: $PLATFORM" >&2
      exit 1
      ;;
  esac
}

DESTINATION="${AGENT_DEVICE_XCUITEST_DESTINATION:-$(resolve_default_destination)}"
DERIVED_PATH="${AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH:-$(resolve_default_derived_path)}"
CLEAN_PATH="$(resolve_clean_path)"

if is_truthy "${AGENT_DEVICE_IOS_CLEAN_DERIVED:-}"; then
  rm -rf "$CLEAN_PATH"
elif should_clean_by_default; then
  rm -rf "$CLEAN_PATH"
fi

xcodebuild build-for-testing \
  -project "$PROJECT_PATH" \
  -scheme "$SCHEME" \
  -destination "$DESTINATION" \
  -derivedDataPath "$DERIVED_PATH" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  DEVELOPMENT_TEAM="" \
  COMPILER_INDEX_STORE_ENABLE=NO \
  ENABLE_CODE_COVERAGE=NO
