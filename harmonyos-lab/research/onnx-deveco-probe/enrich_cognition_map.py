#!/usr/bin/env python3
"""Merge ONNX block detections into cognition-map.json for smart-traverse."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from block_io import detect_blocks

ROOT = Path(__file__).resolve().parent

# DevEco policy-aligned: regions that benefit from swipe exploration
SWIPE_BLOCK_KEYS = frozenset(
    {
        "list",
        "list_h",
        "channel",
        "commentArea",
        "chat",
        "video_list",
        "map",
        "media",
    }
)

BLOCK_SUGGESTIONS: dict[str, str] = {
    "list": "内容列表区：可先向上滑动浏览更多条目，再点击卡片",
    "list_h": "水平列表：可左右滑动探索频道/分类",
    "channel": "频道列表：可点击 Tab 或左右滑动切换频道",
    "menu": "底部导航栏：优先点击未访问的 Tab",
    "search": "搜索区：可点击搜索框或输入关键词",
    "commentArea": "评论区：可向下滑动查看更多评论",
    "popup": "弹窗：优先关闭或同意，避免误入外链",
    "hover": "悬浮框：优先关闭悬浮控件",
    "map": "地图区块：可拖动/滑动地图",
    "media": "媒体播放区：注意播放控件与进度条",
}


def _bounds_str(xyxy: list[float]) -> str:
    x1, y1, x2, y2 = (int(round(v)) for v in xyxy)
    return f"[{x1},{y1}][{x2},{y2}]"


def _dedupe_blocks(blocks: list[dict], iou_thresh: float = 0.5) -> list[dict]:
    """Keep higher-conf box when same class overlaps heavily."""
    blocks = sorted(blocks, key=lambda b: -b["conf"])
    kept: list[dict] = []
    for b in blocks:
        if any(_iou_xyxy(b["xyxy"], k["xyxy"]) > iou_thresh and b["class_key"] == k["class_key"] for k in kept):
            continue
        kept.append(b)
    return kept


def _iou_xyxy(a: list[float], b: list[float]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    if inter <= 0:
        return 0.0
    area_a = max(0, ax2 - ax1) * max(0, ay2 - ay1)
    area_b = max(0, bx2 - bx1) * max(0, by2 - by1)
    return inter / (area_a + area_b - inter + 1e-6)


def enrich(cognition: dict, blocks: list[dict]) -> dict:
    blocks = _dedupe_blocks(blocks)
    ui_blocks = []
    for b in blocks:
        key = b["class_key"]
        action = "swipe" if key in SWIPE_BLOCK_KEYS else "explore"
        ui_blocks.append(
            {
                "classKey": key,
                "classZh": b["class_zh"],
                "conf": round(b["conf"], 4),
                "bounds": _bounds_str(b["xyxy"]),
                "xyxy": [round(v, 1) for v in b["xyxy"]],
                "center": b["center"],
                "area": b["area"],
                "suggestedAction": action,
            }
        )

    cognition = dict(cognition)
    cognition["uiBlocks"] = ui_blocks
    cognition.setdefault("features", {})
    feats = dict(cognition["features"])
    feats["hasListBlock"] = any(b["classKey"] in ("list", "list_h", "channel") for b in ui_blocks)
    feats["hasBottomMenuBlock"] = any(b["classKey"] == "menu" for b in ui_blocks)
    feats["hasPopupBlock"] = any(b["classKey"] in ("popup", "hover") for b in ui_blocks)
    cognition["features"] = feats

    extra: list[str] = []
    seen = set()
    for b in ui_blocks:
        key = b["classKey"]
        if key in seen:
            continue
        seen.add(key)
        tip = BLOCK_SUGGESTIONS.get(key)
        if tip:
            extra.append(f"[ONNX区块/{b['classZh']}] {tip}")
    if extra:
        base = list(cognition.get("suggestions") or [])
        cognition["suggestions"] = base + extra

    cognition["onnxEnrichment"] = {
        "source": "widget_block_detect",
        "blockCount": len(ui_blocks),
        "swipeCandidates": [b for b in ui_blocks if b["suggestedAction"] == "swipe"],
    }
    return cognition


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--cognition", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=None, help="Default: overwrite --cognition")
    parser.add_argument("--conf", type=float, default=0.5)
    parser.add_argument("--max-det", type=int, default=20)
    parser.add_argument(
        "--no-letterbox",
        action="store_true",
        help="Use stretch 640x640 instead of letterbox",
    )
    parser.add_argument("--in-place", action="store_true", help="Alias for writing back to --cognition")
    args = parser.parse_args()

    if not args.image.is_file():
        print(f"image missing: {args.image}", file=sys.stderr)
        return 1
    if not args.cognition.is_file():
        print(f"cognition missing: {args.cognition}", file=sys.stderr)
        return 1

    with args.cognition.open(encoding="utf-8") as f:
        cognition = json.load(f)

    blocks = detect_blocks(
        args.image,
        conf_thres=args.conf,
        max_det=args.max_det,
        letterbox=not args.no_letterbox,
    )
    enriched = enrich(cognition, blocks)

    out = args.cognition if (args.in_place or args.out is None) else args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as f:
        json.dump(enriched, f, ensure_ascii=False, indent=2)

    print(f"blocks: {len(blocks)} -> uiBlocks: {len(enriched.get('uiBlocks', []))}")
    print(f"written: {out}")
    for b in enriched.get("uiBlocks", [])[:8]:
        print(f"  {b['classZh']} conf={b['conf']} action={b['suggestedAction']} center=({b['center']['x']},{b['center']['y']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
