"""Resolve DevEco ONNX model paths from env or macOS defaults."""

from __future__ import annotations

import os
from pathlib import Path

_HOME = Path.home()
_DEVECO = _HOME / "Library/Application Support/DevEco Testing/common/resources"

DEFAULT_PATHS: dict[str, Path] = {
    "widget": _DEVECO
    / "appSenseToolWidgetModel"
    / "widget_recognition.onnx",
    "block": _DEVECO
    / "appSenseToolBlockModel"
    / "widget_block_detect_20241019.onnx",
    "scene": _DEVECO / "appSenseToolSceneModel" / "resnet18_best.onnx",
}

ENV_KEYS = {
    "widget": "DEVECO_WIDGET_ONNX",
    "block": "DEVECO_BLOCK_ONNX",
    "scene": "DEVECO_SCENE_ONNX",
}


def resolve_paths() -> dict[str, Path]:
    out: dict[str, Path] = {}
    for key, default in DEFAULT_PATHS.items():
        env = ENV_KEYS[key]
        raw = os.environ.get(env)
        out[key] = Path(raw).expanduser() if raw else default
    return out


def check_paths(paths: dict[str, Path]) -> list[str]:
    missing: list[str] = []
    for key, p in paths.items():
        if not p.is_file():
            missing.append(f"{key}: {p}")
    return missing
