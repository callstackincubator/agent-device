"""Load DevEco AppSense label maps (plain JSON, not encrypted)."""

from __future__ import annotations

import json
import os
from pathlib import Path

_DEFAULT_APPSENSE_CONFIG = (
    Path.home()
    / "Library/Application Support/DevEco Testing/common/resources"
    / "appSenseToolMain/AppSenseTool/file/config"
)

ENV_APPSENSE_CONFIG = "DEVECO_APPSENSE_CONFIG"


def appsense_config_dir() -> Path:
    raw = os.environ.get(ENV_APPSENSE_CONFIG)
    if raw:
        return Path(raw).expanduser()
    return _DEFAULT_APPSENSE_CONFIG


def load_name_to_id(path: Path) -> dict[str, int]:
    with path.open(encoding="utf-8") as f:
        obj = json.load(f)
    if not isinstance(obj, dict):
        raise ValueError(f"expected object in {path}")
    return {str(k): int(v) for k, v in obj.items()}


def build_id_to_name(name_to_id: dict[str, int]) -> list[str]:
    if not name_to_id:
        return []
    max_id = max(name_to_id.values())
    names = ["<unknown>"] * (max_id + 1)
    for name, idx in name_to_id.items():
        if idx < 0 or idx > max_id:
            continue
        if names[idx] != "<unknown>" and names[idx] != name:
            raise ValueError(f"duplicate id {idx}: {names[idx]!r} vs {name!r}")
        names[idx] = name
    return names


def load_widget_labels(config_dir: Path | None = None) -> tuple[list[str], dict[str, int]]:
    """59-class widget_recognition labels (widget_label.json)."""
    base = config_dir or appsense_config_dir()
    path = base / "widget_label.json"
    name_to_id = load_name_to_id(path)
    id_to_name = build_id_to_name(name_to_id)
    return id_to_name, name_to_id


def load_scene_labels(config_dir: Path | None = None) -> tuple[list[str], dict[str, int]]:
    """9-class scene labels (page_labels.json)."""
    base = config_dir or appsense_config_dir()
    path = base / "page_labels.json"
    name_to_id = load_name_to_id(path)
    return build_id_to_name(name_to_id), name_to_id


def load_block_labels(config_dir: Path | None = None) -> dict[str, str]:
    """Block detector region keys (block_name.json): key -> 中文名."""
    base = config_dir or appsense_config_dir()
    path = base / "block_name.json"
    if not path.is_file():
        path = Path(__file__).resolve().parent / "data" / "block_name.json"
    with path.open(encoding="utf-8") as f:
        obj = json.load(f)
    return {str(k): str(v) for k, v in obj.items()}


def load_block_class_keys(config_dir: Path | None = None) -> list[str]:
    """Class index order = JSON key order (19 classes for block detector)."""
    return list(load_block_labels(config_dir).keys())
