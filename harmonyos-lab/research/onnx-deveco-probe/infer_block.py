#!/usr/bin/env python3
"""Run widget_block_detect ONNX, decode boxes, optionally draw on screenshot."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from block_io import detect_blocks
from label_sources import load_block_class_keys, load_block_labels

ROOT = Path(__file__).resolve().parent


def draw_detections(
    img: Image.Image,
    detections: list[dict],
    class_keys: list[str],
    block_zh: dict[str, str],
) -> Image.Image:
    out = img.convert("RGB").copy()
    draw = ImageDraw.Draw(out)
    try:
        font = ImageFont.truetype("/System/Library/fonts/PingFang.ttc", 22)
    except OSError:
        font = ImageFont.load_default()

    colors = [
        "#e6194b",
        "#3cb44b",
        "#ffe119",
        "#4363d8",
        "#f58231",
        "#911eb4",
        "#46f0f0",
        "#f032e6",
        "#bcf60c",
        "#fabebe",
    ]
    for d in detections:
        x1, y1, x2, y2 = d["xyxy"]
        cid = d["class_id"]
        key = class_keys[cid] if cid < len(class_keys) else "?"
        zh = block_zh.get(key, key)
        label = f"{zh} {d['conf']:.2f}"
        color = colors[cid % len(colors)]
        draw.rectangle([x1, y1, x2, y2], outline=color, width=4)
        draw.text((x1, max(0, y1 - 24)), label, fill=color, font=font)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Block region detector (DevEco ONNX)")
    parser.add_argument("image", type=Path)
    parser.add_argument(
        "--out",
        type=Path,
        default=ROOT / "output" / "block_vis.png",
        help="Annotated image output path",
    )
    parser.add_argument("--json-out", type=Path, default=None, help="Detections JSON")
    parser.add_argument(
        "--decode",
        choices=["deveco", "legacy"],
        default="deveco",
        help="deveco=jar YoloOnnxService; legacy=max class score",
    )
    parser.add_argument("--conf", type=float, default=0.4)
    parser.add_argument("--nms-conf", type=float, default=0.25, help="NMS score threshold (deveco)")
    parser.add_argument("--iou", type=float, default=0.45)
    parser.add_argument("--max-det", type=int, default=30)
    parser.add_argument(
        "--stretch",
        action="store_true",
        help="Use stretch 640x640 instead of letterbox (default: letterbox)",
    )
    args = parser.parse_args()

    if not args.image.is_file():
        print(f"Image not found: {args.image}", file=sys.stderr)
        return 1

    class_keys = load_block_class_keys()
    block_zh = load_block_labels()

    img = Image.open(args.image)
    dets = detect_blocks(
        args.image,
        conf_thres=args.conf,
        iou_thres=args.iou,
        max_det=args.max_det,
        letterbox=not args.stretch,
        decode_mode=args.decode,
        nms_score_threshold=args.nms_conf,
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    vis = draw_detections(img, dets, class_keys, block_zh)
    vis.save(args.out)

    print(f"image: {args.image} ({img.size[0]}x{img.size[1]})")
    print(f"preprocess: {'stretch' if args.stretch else 'letterbox'}  decode: {args.decode}")
    print(f"detections: {len(dets)} (conf>={args.conf})")
    print(f"saved: {args.out}")
    for i, d in enumerate(dets[:15], 1):
        x1, y1, x2, y2 = d["xyxy"]
        print(
            f"  #{i} {d['class_zh']} ({d['class_key']}) conf={d['conf']:.3f} "
            f"box=[{x1:.0f},{y1:.0f},{x2:.0f},{y2:.0f}]"
        )
    if len(dets) > 15:
        print(f"  ... +{len(dets) - 15} more")

    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        with args.json_out.open("w", encoding="utf-8") as f:
            json.dump(
                {
                    "image": str(args.image.resolve()),
                    "letterbox": not args.stretch,
                    "detections": dets,
                },
                f,
                ensure_ascii=False,
                indent=2,
            )
        print(f"json: {args.json_out}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
