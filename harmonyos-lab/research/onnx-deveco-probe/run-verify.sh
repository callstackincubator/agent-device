#!/usr/bin/env bash
# Single-image ONNX verify (uses .venv)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
if [[ ! -x .venv/bin/python ]]; then
  echo "Missing .venv — run: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi
exec .venv/bin/python verify_image.py "$@"
