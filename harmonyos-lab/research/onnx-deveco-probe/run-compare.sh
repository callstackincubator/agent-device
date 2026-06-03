#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
[[ -x .venv/bin/python ]] || { echo "Missing .venv" >&2; exit 1; }
exec .venv/bin/python compare_deveco_onnx.py "$@"
