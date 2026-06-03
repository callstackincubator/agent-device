#!/usr/bin/env python3
"""Run widget_recognition.onnx on full image or crop; print top-k Chinese labels."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

from label_sources import appsense_config_dir, build_id_to_name, load_name_to_id
from model_paths import check_paths, resolve_paths

ROOT = Path(__file__).resolve().parent
IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def load_labels(labels_path: Path | None) -> list[str]:
    if labels_path and labels_path.is_file():
        name_to_id = load_name_to_id(labels_path)
        return build_id_to_name(name_to_id)
    config = appsense_config_dir()
    path = config / "widget_label.json"
    if path.is_file():
        name_to_id = load_name_to_id(path)
        return build_id_to_name(name_to_id)
    bundled = ROOT / "data" / "widget_label.json"
    name_to_id = load_name_to_id(bundled)
    return build_id_to_name(name_to_id)


def preprocess(img: Image.Image, norm: str) -> np.ndarray:
    img = img.convert("RGB").resize((224, 224), Image.Resampling.BILINEAR)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    arr = np.transpose(arr, (2, 0, 1))
    if norm == "imagenet":
        for c in range(3):
            arr[c] = (arr[c] - IMAGENET_MEAN[c]) / IMAGENET_STD[c]
    return arr[np.newaxis, ...]


def softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - np.max(x))
    return e / e.sum()


def infer(
    session: ort.InferenceSession,
    tensor: np.ndarray,
) -> np.ndarray:
    name = session.get_inputs()[0].name
    out = session.run(None, {name: tensor})[0]
    return out[0]


def parse_crop(s: str) -> tuple[int, int, int, int]:
    parts = [int(p.strip()) for p in s.split(",")]
    if len(parts) != 4:
        raise ValueError("crop must be left,top,right,bottom")
    return parts[0], parts[1], parts[2], parts[3]


def main() -> int:
    parser = argparse.ArgumentParser(description="Widget ONNX top-k inference")
    parser.add_argument("image", type=Path, help="Screenshot path")
    parser.add_argument(
        "--labels",
        type=Path,
        default=None,
        help="widget_label.json (default: AppSense config or data/widget_label.json)",
    )
    parser.add_argument(
        "--norm",
        choices=["imagenet", "zero_one"],
        default="imagenet",
        help="Input normalization (ResNet 常用 imagenet)",
    )
    parser.add_argument("--top", type=int, default=5)
    parser.add_argument(
        "--crop",
        type=str,
        default=None,
        help="Optional crop: left,top,right,bottom in pixels",
    )
    parser.add_argument("--json", action="store_true", help="Print JSON result")
    args = parser.parse_args()

    paths = resolve_paths()
    missing = check_paths(paths)
    if missing:
        print("Missing ONNX:", missing, file=sys.stderr)
        return 1
    if not args.image.is_file():
        print(f"Image not found: {args.image}", file=sys.stderr)
        return 1

    labels = load_labels(args.labels)
    if len(labels) != 59:
        print(f"WARN: expected 59 labels, got {len(labels)}", file=sys.stderr)

    sess = ort.InferenceSession(
        str(paths["widget"]), providers=["CPUExecutionProvider"]
    )
    img = Image.open(args.image)
    if args.crop:
        l, t, r, b = parse_crop(args.crop)
        img = img.crop((l, t, r, b))

    tensor = preprocess(img, args.norm)
    logits = infer(sess, tensor)
    probs = softmax(logits)
    order = np.argsort(probs)[::-1][: args.top]

    rows = []
    for rank, idx in enumerate(order, start=1):
        idx = int(idx)
        name = labels[idx] if idx < len(labels) else f"<id {idx}>"
        rows.append(
            {
                "rank": rank,
                "id": idx,
                "label": name,
                "prob": float(probs[idx]),
                "logit": float(logits[idx]),
            }
        )

    if args.json:
        print(
            json.dumps(
                {
                    "image": str(args.image.resolve()),
                    "norm": args.norm,
                    "crop": args.crop,
                    "top": rows,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print(f"image: {args.image}")
        print(f"norm: {args.norm}")
        if args.crop:
            print(f"crop: {args.crop}")
        for row in rows:
            print(
                f"  #{row['rank']} id={row['id']:2d} "
                f"p={row['prob']:.4f}  {row['label']}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
