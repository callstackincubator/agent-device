#!/usr/bin/env python3
"""Verify label JSON from DevEco AppSense vs bundled copies."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from label_sources import (
    appsense_config_dir,
    load_block_labels,
    load_scene_labels,
    load_widget_labels,
)

ROOT = Path(__file__).resolve().parent
BUNDLED_WIDGET = ROOT / "data" / "widget_label.json"
BUNDLED_SCENE = ROOT / "data" / "page_labels.json"


def _load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def main() -> int:
    config = appsense_config_dir()
    print(f"AppSense config dir: {config}")
    if not config.is_dir():
        print("  MISSING — install appSenseToolMain via DevEco first", file=sys.stderr)
        return 1

    widget_names, widget_map = load_widget_labels(config)
    scene_names, scene_map = load_scene_labels(config)
    block_map = load_block_labels(config)

    print(f"\nwidget_label.json: {len(widget_map)} names, ids 0..{len(widget_names)-1}")
    print("  sample:", widget_names[:5], "...", widget_names[-3:])

    print(f"\npage_labels.json (scene): {len(scene_map)} classes")
    for name, idx in sorted(scene_map.items(), key=lambda x: x[1]):
        print(f"  {idx}: {name}")

    print(f"\nblock_name.json: {len(block_map)} block types")
    for k, v in list(block_map.items())[:8]:
        print(f"  {k} -> {v}")
    print("  ...")

    if BUNDLED_WIDGET.is_file():
        bundled = _load_json(BUNDLED_WIDGET)
        if bundled == widget_map:
            print("\nBundled data/widget_label.json matches AppSense ✓")
        else:
            print("\nWARN: bundled widget_label.json differs from AppSense", file=sys.stderr)

    if BUNDLED_SCENE.is_file():
        bundled_scene = _load_json(BUNDLED_SCENE)
        if bundled_scene == scene_map:
            print("Bundled data/page_labels.json matches AppSense ✓")
        else:
            print("WARN: bundled page_labels.json differs from AppSense", file=sys.stderr)

    bundled_block = ROOT / "data" / "block_name.json"
    if bundled_block.is_file():
        bundled_b = _load_json(bundled_block)
        if bundled_b == block_map:
            print("Bundled data/block_name.json matches AppSense ✓")
        else:
            print("WARN: bundled block_name.json differs from AppSense", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
