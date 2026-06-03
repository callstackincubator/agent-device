#!/bin/bash
# 在 HarmonyOS 设备上跑单个 App 的安全认知遍历
set -euo pipefail

BUNDLE="${1:?用法: $0 <bundle> [ability] [output-dir] [session-name]}"
shift
ABILITY=""
if [ $# -gt 0 ] && [[ "$1" != ./* ]] && [[ "$1" != /* ]] && [[ "$1" != *"/"* ]]; then
  ABILITY="$1"
  shift
fi
OUT="${1:-./traverse-output/smart-$(echo "$BUNDLE" | tr '.' '-')}"
SESSION="${2:-traverse-$(echo "$BUNDLE" | tr '.' '-' | tail -c 20)}"
MODULE="${TRAVERSE_OPEN_MODULE:-}"
STATE_DIR="/private/tmp/agent-device-${SESSION}"
DEVICE="${TRAVERSE_DEVICE:-${TRAVERSE_HDC_TARGET:-$(hdc list targets 2>/dev/null | awk 'NF && $0 != "[Empty]" { print; exit }' | tr -d ' ')}}"
HDC_TARGET="${TRAVERSE_HDC_TARGET:-$DEVICE}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"

echo "=== uitest 预检 ==="
TRAVERSE_DEVICE="$DEVICE" TRAVERSE_HDC_TARGET="$HDC_TARGET" node scripts/ensure-harmony-uitest-ready.mjs

if [ "${TRAVERSE_CLEAR_APP_STORAGE:-1}" != "0" ]; then
  echo "=== 清理 App 数据/缓存（重置隐私弹窗等首启状态）==="
  TRAVERSE_DEVICE="$DEVICE" TRAVERSE_HDC_TARGET="$HDC_TARGET" \
    TRAVERSE_CLEAR_APP_DATA="${TRAVERSE_CLEAR_APP_DATA:-1}" \
    TRAVERSE_CLEAR_APP_CACHE="${TRAVERSE_CLEAR_APP_CACHE:-1}" \
    node scripts/clear-harmony-app-storage.mjs "$BUNDLE"
fi

if [ -z "$ABILITY" ]; then
  ABILITY="$(TRAVERSE_DEVICE="$DEVICE" TRAVERSE_HDC_TARGET="$HDC_TARGET" \
    node scripts/resolve-harmony-launch-ability.mjs "$BUNDLE" || true)"
  if [ -n "$ABILITY" ]; then
    echo "=== launchAbility (apps --json): $ABILITY ==="
  else
    echo "=== launchAbility 未解析，open 将走 wukong 自动回退 ==="
  fi
fi

echo "=== 打开 $BUNDLE ==="
OPEN_ARGS=(open "$BUNDLE")
if [ -n "$ABILITY" ]; then OPEN_ARGS+=(--activity "$ABILITY"); fi
if [ -n "$MODULE" ]; then OPEN_ARGS+=(--module "$MODULE"); fi
node dist/src/cli.js --platform harmonyos --device "$DEVICE" \
  --session "$SESSION" --state-dir "$STATE_DIR" \
  "${OPEN_ARGS[@]}" --json || true

echo "=== 安全遍历 $BUNDLE ==="
TRAVERSE_TARGET_BUNDLE="$BUNDLE" \
TRAVERSE_OPEN_ACTIVITY="$ABILITY" \
TRAVERSE_OPEN_MODULE="$MODULE" \
TRAVERSE_OUT="$OUT" \
TRAVERSE_SESSION="$SESSION" \
TRAVERSE_STATE_DIR="$STATE_DIR" \
TRAVERSE_DEVICE="$DEVICE" \
TRAVERSE_HDC_TARGET="$HDC_TARGET" \
TRAVERSE_MAX_DEPTH="${TRAVERSE_MAX_DEPTH:-2}" \
TRAVERSE_MAX_TARGETS="${TRAVERSE_MAX_TARGETS:-12}" \
TRAVERSE_RUN_UNTIL_SEC="${TRAVERSE_RUN_UNTIL_SEC:-}" \
node scripts/smart-traverse-from-cognition.mjs

echo "=== 关闭 session $SESSION ==="
node dist/src/cli.js --platform harmonyos --device "$DEVICE" \
  --session "$SESSION" --state-dir "$STATE_DIR" close --json

echo "报告: $OUT/smart-traverse-report.md"
