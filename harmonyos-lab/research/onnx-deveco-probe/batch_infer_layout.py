#!/usr/bin/env python3
"""Run widget ONNX on crops from agent-device layout JSON (snapshot --json shape)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

from infer_widget import infer, load_labels, preprocess, softmax
from model_paths import check_paths, resolve_paths

ROOT = Path(__file__).resolve().parent


def _iter_nodes(obj: dict) -> list[dict]:
    data = obj.get("data") or obj
    nodes = data.get("nodes") or []
    return [n for n in nodes if isinstance(n, dict)]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("layout_json", type=Path)
    parser.add_argument("--image", type=Path, required=True, help="Screenshot matching layout")
    parser.add_argument("--max", type=int, default=12, help="Max nodes to classify")
    parser.add_argument("--min-size", type=int, default=32, help="Min crop width/height")
    parser.add_argument("--norm", choices=["imagenet", "zero_one"], default="imagenet")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    paths = resolve_paths()
    if check_paths(paths):
        return 1
    if not args.layout_json.is_file() or not args.image.is_file():
        print("layout or image missing", file=sys.stderr)
        return 1

    with args.layout_json.open(encoding="utf-8") as f:
        layout = json.load(f)

    labels = load_labels(None)
    sess = ort.InferenceSession(str(paths["widget"]), providers=["CPUExecutionProvider"])
    img = Image.open(args.image)

    candidates = []
    for n in _iter_nodes(layout):
        rect = n.get("rect") or {}
        w = int(rect.get("width") or 0)
        h = int(rect.get("height") or 0)
        if w < args.min_size or h < args.min_size:
            continue
        if not n.get("enabled", True):
            continue
        label = n.get("label") or n.get("text") or n.get("type") or ""
        candidates.append((w * h, n, label))

    candidates.sort(key=lambda x: x[0])
    # prefer smaller actionable widgets (buttons), not full screen
    candidates = candidates[: args.max]

    results = []
    for _, node, tree_label in candidates:
        rect = node["rect"]
        l, t = int(rect["x"]), int(rect["y"])
        r, b = l + int(rect["width"]), t + int(rect["height"])
        crop = img.crop((l, t, r, b))
        tensor = preprocess(crop, args.norm)
        logits = infer(sess, tensor)
        probs = softmax(logits)
        idx = int(np.argmax(probs))
        results.append(
            {
                "ref": node.get("ref"),
                "type": node.get("type"),
                "treeLabel": tree_label[:80] if tree_label else "",
                "rect": rect,
                "widgetId": idx,
                "widgetLabel": labels[idx] if idx < len(labels) else None,
                "prob": float(probs[idx]),
            }
        )

    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        print(f"layout: {args.layout_json.name}  image: {args.image.name}  nodes: {len(results)}\n")
        for row in results:
            print(
                f"{row.get('ref')} [{row.get('type')}] "
                f"tree={(row.get('treeLabel') or '')[:40]!r} -> "
                f"{row.get('widgetLabel')} ({row.get('prob'):.3f}) "
                f"rect={row.get('rect')}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
