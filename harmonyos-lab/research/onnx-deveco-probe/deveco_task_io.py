"""Load DevEco explore-test graph: scenes, screenshots, official widgetBlockList."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from label_sources import load_block_labels

_BOUNDS_RE = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]")


@dataclass
class DevEcoBlock:
    block_id: str
    class_zh: str
    class_key: str | None
    bounds: tuple[int, int, int, int]  # x1,y1,x2,y2
    text: str
    xpath: str


@dataclass
class DevEcoScene:
    node_id: str
    exact_scene_id: str
    img_name: str
    layout_name: str
    screen_size: str
    title: str
    blocks: list[DevEcoBlock]


def parse_bounds(s: str) -> tuple[int, int, int, int] | None:
    m = _BOUNDS_RE.match((s or "").strip())
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))


def zh_to_class_key() -> dict[str, str]:
    block_zh = load_block_labels()
    return {zh: key for key, zh in block_zh.items()}


def load_graph_scenes(graph_path: Path) -> list[DevEcoScene]:
    data = json.loads(graph_path.read_text(encoding="utf-8"))
    zh_map = zh_to_class_key()
    scenes: list[DevEcoScene] = []

    for node_id, node in (data.get("nodes") or {}).items():
        for sc in node.get("exactScenes") or []:
            wbl = sc.get("widgetBlockList")
            if not wbl:
                continue
            blocks: list[DevEcoBlock] = []
            for bid, b in wbl.items():
                bounds = parse_bounds(b.get("bounds", ""))
                if not bounds:
                    continue
                zh = (b.get("widgetLabel") or b.get("widgetDescription") or "").strip()
                blocks.append(
                    DevEcoBlock(
                        block_id=str(bid),
                        class_zh=zh,
                        class_key=zh_map.get(zh),
                        bounds=bounds,
                        text=(b.get("text") or "")[:80],
                        xpath=(b.get("xpath") or "")[:120],
                    )
                )
            scenes.append(
                DevEcoScene(
                    node_id=str(node_id),
                    exact_scene_id=str(sc.get("exactSceneId", "")),
                    img_name=str(sc.get("img", "")),
                    layout_name=str(sc.get("layout", "")),
                    screen_size=str(sc.get("screenSize", "")),
                    title=str(sc.get("title", "")),
                    blocks=blocks,
                )
            )
    return scenes


def find_scene(
    scenes: list[DevEcoScene],
    *,
    img_stem: str | None = None,
    layout_stem: str | None = None,
) -> DevEcoScene | None:
    for sc in scenes:
        if img_stem and sc.img_name.replace(".jpeg", "").replace(".jpg", "") == img_stem:
            return sc
        if layout_stem and sc.layout_name.replace(".json", "") == layout_stem:
            return sc
    return None


def resolve_screenshot(task_dir: Path, img_name: str) -> Path | None:
    """Task dir = .../tasks/<uuid>/"""
    candidates = [
        task_dir / "graph" / "screenshot" / img_name,
        task_dir / "export" / "resourceFile" / img_name,
        task_dir / "data" / "screenshot" / img_name,
    ]
    for p in candidates:
        if p.is_file():
            return p
    return None


def scale_bounds(
    bounds: tuple[int, int, int, int],
    *,
    from_w: int,
    from_h: int,
    to_w: int,
    to_h: int,
) -> tuple[int, int, int, int]:
    if from_w <= 0 or from_h <= 0:
        return bounds
    sx = to_w / from_w
    sy = to_h / from_h
    x1, y1, x2, y2 = bounds
    return (
        int(round(x1 * sx)),
        int(round(y1 * sy)),
        int(round(x2 * sx)),
        int(round(y2 * sy)),
    )


def parse_screen_size(s: str) -> tuple[int, int] | None:
    m = re.match(r"(\d+)x(\d+)", (s or "").strip())
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))
