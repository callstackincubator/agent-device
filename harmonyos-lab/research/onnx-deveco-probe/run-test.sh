#!/usr/bin/env bash
# 用本目录 .venv 跑 test_onnx_capabilities.py（避免系统 python3 缺 onnxruntime）
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi
exec .venv/bin/python test_onnx_capabilities.py "$@"
