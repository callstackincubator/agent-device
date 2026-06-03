#!/bin/bash
# HarmonyOS App Deep Traversal Script
# 自动遍历应用界面，记录View树结构

set -e

SESSION="${1:-traverse}"
OUTPUT_DIR="${2:-./traverse-output}"

mkdir -p "$OUTPUT_DIR/screenshots"
mkdir -p "$OUTPUT_DIR/snapshots"

SCREEN_COUNT=0
LOG_FILE="$OUTPUT_DIR/traverse.log"
SUMMARY_FILE="$OUTPUT_DIR/summary.json"

echo "Starting traversal session: $SESSION"
echo "Output: $OUTPUT_DIR"

# 保存当前界面
function save_screen() {
    SCREEN_COUNT=$((SCREEN_COUNT + 1))
    local name="screen_${SCREEN_COUNT}"

    node dist/src/cli.js snapshot --session "$SESSION" --json > "$OUTPUT_DIR/snapshots/${name}.json" 2>/dev/null
    node dist/src/cli.js screenshot --session "$SESSION" "$OUTPUT_DIR/screenshots/${name}.png" --json >/dev/null 2>&1

    local nodes=$(cat "$OUTPUT_DIR/snapshots/${name}.json" | jq '.data.nodes | length')
    local depth=$(cat "$OUTPUT_DIR/snapshots/${name}.json" | jq '.data.analysis.maxDepth // 0')

    echo "Screen $SCREEN_COUNT: $nodes nodes, depth=$depth"
}

# 获取可点击元素
function get_clickable() {
    node dist/src/cli.js snapshot -i --session "$SESSION" --json 2>/dev/null | \
        jq -r '.data.nodes[] | select(.hittable) | "\(.ref)|\(.label // .value // "-")"'
}

# 点击并检测变化
function try_click() {
    local ref="$1"
    node dist/src/cli.js press --session "$SESSION" "$ref" --json >/dev/null 2>&1
    sleep 2
    save_screen
    node dist/src/cli.js back --session "$SESSION" >/dev/null 2>&1
    sleep 1
}

# 主流程
echo "=== Starting Traverse ==="
save_screen

# 遍历Tab（如果有）
for tab in "推荐" "直播" "美食" "穿搭"; do
    node dist/src/cli.js press --session "$SESSION" "label=\"$tab\"" --json >/dev/null 2>&1
    sleep 2
    save_screen
done

# 点击几个内容项
for i in 1 2 3; do
    local first=$(get_clickable | head -1)
    if [ -n "$first" ]; then
        local ref=$(echo "$first" | cut -d'|' -f1)
        try_click "$ref"
    fi
done

echo "=== Complete: $SCREEN_COUNT screens ==="

# 生成报告
cat "$OUTPUT_DIR/snapshots/screen_*.json" | jq -s '{
  screens: [.[] | {nodes: (.data.nodes | length), depth: (.data.analysis.maxDepth // 0)}],
  totalScreens: length,
  totalNodes: (.[].data.nodes | length | add),
  maxDepth: (.[].data.analysis.maxDepth // 0 | max)
}' > "$SUMMARY_FILE"

echo "Summary saved to: $SUMMARY_FILE"
cat "$SUMMARY_FILE"