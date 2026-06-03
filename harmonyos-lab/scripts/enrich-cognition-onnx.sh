#!/usr/bin/env bash
# 可选：用 DevEco block ONNX 丰富 cognition-map.json（不接入 smart-traverse）
# 单图验证请用: onnx-deveco-probe/verify_image.py
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROBE="$ROOT/onnx-deveco-probe"
PY="${PROBE}/.venv/bin/python"
IMAGE="${1:?screenshot.png}"
COGNITION="${2:?cognition-map.json}"
CONF="${3:-0.5}"

if [[ ! -x "$PY" ]]; then
  echo "Missing venv: cd onnx-deveco-probe && python3 -m venv .venv && pip install -r requirements.txt" >&2
  exit 1
fi

exec "$PY" "$PROBE/enrich_cognition_map.py" --image "$IMAGE" --cognition "$COGNITION" --in-place --conf "$CONF"
