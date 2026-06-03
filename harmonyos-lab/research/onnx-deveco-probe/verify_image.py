#!/usr/bin/env python3
"""Single-image ONNX resolution check (block + optional widget crops).

Standalone DevEco model validation — not wired into smart-traverse.

Examples:
  .venv/bin/python verify_image.py ../traverse-output/xhs-smart-v3/screens/s2_d1.png
  .venv/bin/python verify_image.py screenshot.png --decode deveco --conf 0.4
  .venv/bin/python verify_image.py screenshot.png --layout layout.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import numpy as np

from block_io import detect_blocks
from infer_widget import infer, load_labels, preprocess, softmax
from label_sources import load_block_class_keys, load_block_labels
from model_paths import check_paths, resolve_paths

import onnxruntime as ort

ROOT = Path(__file__).resolve().parent


def _parse_bounds(s: str) -> tuple[int, int, int, int] | None:
    # [x1,y1][x2,y2]
    import re

    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", s.strip())
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))


def _layout_clickables(layout_path: Path, limit: int = 8) -> list[dict]:
    with layout_path.open(encoding="utf-8") as f:
        data = json.load(f)

    nodes: list[dict] = []

    def walk(n: dict) -> None:
        if not isinstance(n, dict):
            return
        attrs = n.get("attributes") or {}
        bounds = attrs.get("bounds") or attrs.get("origBounds") or ""
        clickable = str(attrs.get("clickable", "")).lower() == "true"
        text = (attrs.get("text") or attrs.get("description") or "").strip()
        if clickable and bounds:
            rect = _parse_bounds(bounds)
            if rect:
                x1, y1, x2, y2 = rect
                nodes.append(
                    {
                        "text": text[:40],
                        "type": attrs.get("type", ""),
                        "bounds": rect,
                        "cx": (x1 + x2) // 2,
                        "cy": (y1 + y2) // 2,
                    }
                )
        for ch in n.get("children") or []:
            walk(ch)

    if isinstance(data, list):
        for root in data:
            walk(root)
    else:
        walk(data)

    nodes.sort(key=lambda n: (n["cy"], n["cx"]))
    return nodes[:limit]


def _draw_blocks(img: Image.Image, dets: list[dict], class_keys: list[str], block_zh: dict) -> Image.Image:
    out = img.convert("RGB").copy()
    draw = ImageDraw.Draw(out)
    try:
        font = ImageFont.truetype("/System/Library/fonts/PingFang.ttc", 20)
    except OSError:
        font = ImageFont.load_default()
    colors = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#46f0f0"]
    for d in dets:
        x1, y1, x2, y2 = d["xyxy"]
        cid = d["class_id"]
        key = class_keys[cid] if cid < len(class_keys) else "?"
        zh = block_zh.get(key, key)
        label = f"{zh} {d['conf']:.2f}"
        color = colors[cid % len(colors)]
        draw.rectangle([x1, y1, x2, y2], outline=color, width=3)
        draw.text((x1, max(0, y1 - 22)), label, fill=color, font=font)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify DevEco ONNX on one screenshot")
    parser.add_argument("image", type=Path)
    parser.add_argument(
        "--decode",
        choices=["legacy", "deveco"],
        default="deveco",
        help="legacy=max class conf; deveco=jar YoloOnnxService-style",
    )
    parser.add_argument("--conf", type=float, default=0.4, help="objectness / fallback class gate")
    parser.add_argument("--nms-conf", type=float, default=0.25, help="per-class NMS score thresh (deveco)")
    parser.add_argument("--iou", type=float, default=0.45)
    parser.add_argument("--max-det", type=int, default=30)
    parser.add_argument("--layout", type=Path, default=None, help="dumpLayout JSON for widget crops")
    parser.add_argument("--widget-top", type=int, default=5)
    parser.add_argument("--out-dir", type=Path, default=ROOT / "output" / "verify")
    parser.add_argument("--json-out", type=Path, default=None)
    args = parser.parse_args()

    paths = resolve_paths()
    missing = check_paths(paths)
    if missing:
        print("Missing ONNX:", missing, file=sys.stderr)
        return 1
    if not args.image.is_file():
        print(f"Image not found: {args.image}", file=sys.stderr)
        return 1

    img = Image.open(args.image)
    orig_w, orig_h = img.size
    class_keys = load_block_class_keys()
    block_zh = load_block_labels()

    if args.decode == "deveco":
        dets = detect_blocks(
            args.image,
            conf_thres=args.conf,
            iou_thres=args.iou,
            max_det=args.max_det,
            letterbox=True,
            decode_mode="deveco",
            nms_score_threshold=args.nms_conf,
        )
    else:
        dets = detect_blocks(
            args.image,
            conf_thres=args.conf,
            iou_thres=args.iou,
            max_det=args.max_det,
            letterbox=True,
            decode_mode="legacy",
        )

    args.out_dir.mkdir(parents=True, exist_ok=True)
    stem = args.image.stem
    vis_path = args.out_dir / f"{stem}_verify_blocks.png"
    _draw_blocks(img, dets, class_keys, block_zh).save(vis_path)

    report: dict = {
        "image": str(args.image.resolve()),
        "size": [orig_w, orig_h],
        "decode": args.decode,
        "thresholds": {
            "conf": args.conf,
            "nmsScore": args.nms_conf,
            "iou": args.iou,
        },
        "blockDetections": dets,
        "blockVis": str(vis_path),
    }

    print(f"image: {args.image} ({orig_w}x{orig_h})")
    print(f"decode: {args.decode}  detections: {len(dets)}")
    print(f"vis: {vis_path}")
    for i, d in enumerate(dets[:12], 1):
        x1, y1, x2, y2 = (int(v) for v in d["xyxy"])
        print(
            f"  #{i} {d.get('class_zh', d.get('class_key'))} "
            f"conf={d['conf']:.3f} box=[{x1},{y1},{x2},{y2}]"
        )
    if len(dets) > 12:
        print(f"  ... +{len(dets) - 12} more")

    if args.layout and args.layout.is_file():
        labels = load_labels(None)
        sess = ort.InferenceSession(str(paths["widget"]), providers=["CPUExecutionProvider"])
        widget_rows = []
        for node in _layout_clickables(args.layout, limit=args.widget_top):
            x1, y1, x2, y2 = node["bounds"]
            if x2 - x1 < 8 or y2 - y1 < 8:
                continue
            crop = img.crop((x1, y1, x2, y2))
            tensor = preprocess(crop, "imagenet")
            logits = infer(sess, tensor)
            probs = softmax(logits)
            top_id = int(np.argmax(probs))
            widget_rows.append(
                {
                    "bounds": node["bounds"],
                    "text": node["text"],
                    "type": node["type"],
                    "topLabel": labels[top_id] if top_id < len(labels) else "?",
                    "topProb": float(probs[top_id]),
                }
            )
        report["widgetCrops"] = widget_rows
        print(f"\nwidget crops ({len(widget_rows)} clickable nodes):")
        for row in widget_rows:
            print(
                f"  {row['topLabel']} p={row['topProb']:.3f} "
                f"text={row['text']!r} bounds={row['bounds']}"
            )

    json_path = args.json_out or (args.out_dir / f"{stem}_verify.json")
    json_path.parent.mkdir(parents=True, exist_ok=True)
    with json_path.open("w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\njson: {json_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
