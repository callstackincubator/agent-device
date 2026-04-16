#!/bin/sh
set -eu

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <version> <release-tag> <output-dir>" >&2
  exit 1
fi

VERSION="$1"
RELEASE_TAG="$2"
OUTPUT_DIR="$3"

DERIVED_PATH="${AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH:-$HOME/.agent-device/ios-runner/derived}"
PRODUCTS_DIR="$DERIVED_PATH/Build/Products"
EXPECTED_RUNNER_BUNDLE_ID="${AGENT_DEVICE_IOS_RUNNER_RELEASE_BUNDLE_ID:-com.callstack.agentdevice.runner.uitests.xctrunner}"
ARCHIVE_BASENAME="agent-device-ios-runner-$VERSION.app.tar.gz"
CHECKSUM_BASENAME="$ARCHIVE_BASENAME.sha256"
MANIFEST_BASENAME="agent-device-ios-runner-$VERSION.manifest.json"
GITHUB_SERVER="${GITHUB_SERVER_URL:-https://github.com}"
REPOSITORY="${GITHUB_REPOSITORY:-}"

if [ ! -d "$PRODUCTS_DIR" ]; then
  echo "Runner build products not found at $PRODUCTS_DIR" >&2
  exit 1
fi

read_plist_value() {
  plist_path="$1"
  key="$2"
  /usr/libexec/PlistBuddy -c "Print :$key" "$plist_path" 2>/dev/null || true
}

write_github_output() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s\n' "$1" >> "$GITHUB_OUTPUT"
  fi
}

resolve_runner_app_path() {
  find "$PRODUCTS_DIR" -type d -name '*.app' | sort | while IFS= read -r app_path; do
    bundle_id="$(read_plist_value "$app_path/Info.plist" CFBundleIdentifier)"
    if [ "$bundle_id" = "$EXPECTED_RUNNER_BUNDLE_ID" ]; then
      printf '%s\n' "$app_path"
      exit 0
    fi
  done
}

RUNNER_APP_PATH="$(resolve_runner_app_path)"
if [ -z "$RUNNER_APP_PATH" ]; then
  echo "Unable to locate simulator runner app with bundle id $EXPECTED_RUNNER_BUNDLE_ID under $PRODUCTS_DIR" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agent-device-ios-runner.XXXXXX")"
cleanup() {
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT INT TERM

STAGED_APP_PATH="$STAGE_DIR/agent-device-ios-runner-$VERSION.app"
ARCHIVE_PATH="$OUTPUT_DIR/$ARCHIVE_BASENAME"
CHECKSUM_PATH="$OUTPUT_DIR/$CHECKSUM_BASENAME"
MANIFEST_PATH="$OUTPUT_DIR/$MANIFEST_BASENAME"
RUNNER_BUNDLE_ID="$(read_plist_value "$RUNNER_APP_PATH/Info.plist" CFBundleIdentifier)"
APP_NAME="$(read_plist_value "$RUNNER_APP_PATH/Info.plist" CFBundleName)"
if [ -z "$APP_NAME" ]; then
  APP_NAME="$(basename "$RUNNER_APP_PATH" .app)"
fi

ditto "$RUNNER_APP_PATH" "$STAGED_APP_PATH"
rm -f "$ARCHIVE_PATH"
(
  cd "$STAGE_DIR"
  COPYFILE_DISABLE=1 tar -czf "$ARCHIVE_PATH" "$(basename "$STAGED_APP_PATH")"
)

SHA256="$(shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}')"
printf '%s  %s\n' "$SHA256" "$ARCHIVE_BASENAME" > "$CHECKSUM_PATH"

if [ -n "$REPOSITORY" ]; then
  ARCHIVE_URL="$GITHUB_SERVER/$REPOSITORY/releases/download/$RELEASE_TAG/$ARCHIVE_BASENAME"
else
  ARCHIVE_URL=""
fi

{
  printf '{\n'
  printf '  "version": "%s",\n' "$VERSION"
  printf '  "release_tag": "%s",\n' "$RELEASE_TAG"
  printf '  "asset_name": "%s",\n' "$ARCHIVE_BASENAME"
  if [ -n "$ARCHIVE_URL" ]; then
    printf '  "asset_url": "%s",\n' "$ARCHIVE_URL"
  else
    printf '  "asset_url": null,\n'
  fi
  printf '  "sha256": "%s",\n' "$SHA256"
  printf '  "checksum_name": "%s",\n' "$CHECKSUM_BASENAME"
  printf '  "bundle_id": "%s",\n' "$RUNNER_BUNDLE_ID"
  printf '  "bundle_name": "%s",\n' "$APP_NAME"
  printf '  "platform_target": "iphonesimulator",\n'
  printf '  "archive_format": "tar.gz"\n'
  printf '}\n'
} > "$MANIFEST_PATH"

write_github_output "runner_app_path=$RUNNER_APP_PATH"
write_github_output "archive_path=$ARCHIVE_PATH"
write_github_output "checksum_path=$CHECKSUM_PATH"
write_github_output "manifest_path=$MANIFEST_PATH"
write_github_output "archive_name=$ARCHIVE_BASENAME"
write_github_output "sha256=$SHA256"
write_github_output "bundle_id=$RUNNER_BUNDLE_ID"

printf 'archive=%s\n' "$ARCHIVE_PATH"
printf 'checksum=%s\n' "$CHECKSUM_PATH"
printf 'manifest=%s\n' "$MANIFEST_PATH"
