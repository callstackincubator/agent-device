#!/usr/bin/env python3
"""Compare DevEco official widgetBlockList vs onnx-deveco-probe detections (IOU).

Example:
  .venv/bin/python compare_deveco_onnx.py \\
    --task-dir "$HOME/Library/Application Support/DevEco Testing/12189/tasks/33837f41-..." \\
    --scene DD1862C5CF8F346DBB265FF3E531D962 \\
    --decode deveco --conf 0.9

  .venv/bin/python compare_deveco_onnx.py --task-dir ... --list-scenes
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

from block_io import detect_blocks
from deveco_task_io import (
    DevEcoBlock,
    find_scene,
    load_graph_scenes,
    parse_screen_size,
    resolve_screenshot,
    scale_bounds,
)

ROOT = Path(__file__).resolve().parent


def iou_xyxy(
    a: tuple[int, int, int, int],
    b: tuple[int, int, int, int],
) -> float:
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


def xyxy_from_det(d: dict) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = d["xyxy"]
    return int(x1), int(y1), int(x2), int(y2)


def match_blocks(
    official: list,
    predicted: list[dict],
    *,
    iou_thresh: float = 0.5,
    require_same_class: bool = False,
) -> dict:
    """Greedy match official -> best ONNX box."""
    used_pred: set[int] = set()
    matches: list[dict] = []
    unmatched_official: list = []
    unmatched_pred = list(range(len(predicted)))

    for ob in official:
        best_i = None
        best_iou = 0.0
        obox = ob.bounds if hasattr(ob, "bounds") else ob["bounds"]
        okey = ob.class_key if hasattr(ob, "class_key") else ob.get("class_key")
        for pi, pd in enumerate(predicted):
            if pi in used_pred:
                continue
            pbox = xyxy_from_det(pd)
            if require_same_class and okey and pd.get("class_key") != okey:
                continue
            v = iou_xyxy(obox, pbox)
            if v > best_iou:
                best_iou = v
                best_i = pi
        if best_i is not None and best_iou >= iou_thresh:
            used_pred.add(best_i)
            if best_i in unmatched_pred:
                unmatched_pred.remove(best_i)
            pd = predicted[best_i]
            matches.append(
                {
                    "officialZh": ob.class_zh if hasattr(ob, "class_zh") else ob.get("class_zh"),
                    "officialKey": okey,
                    "officialBounds": list(obox),
                    "predKey": pd.get("class_key"),
                    "predZh": pd.get("class_zh"),
                    "predBounds": list(xyxy_from_det(pd)),
                    "iou": round(best_iou, 4),
                    "predConf": pd.get("conf"),
                }
            )
        else:
            unmatched_official.append(ob)

    return {
        "matches": matches,
        "unmatchedOfficial": [
            {
                "classZh": ob.class_zh,
                "classKey": ob.class_key,
                "bounds": list(ob.bounds),
            }
            for ob in unmatched_official
        ],
        "unmatchedPred": [
            {
                "classZh": predicted[i].get("class_zh"),
                "classKey": predicted[i].get("class_key"),
                "bounds": list(xyxy_from_det(predicted[i])),
                "conf": predicted[i].get("conf"),
            }
            for i in unmatched_pred
        ],
        "recall": len(matches) / max(1, len(official)),
        "precision": len(matches) / max(1, len(predicted)),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="DevEco widgetBlockList vs ONNX IOU")
    parser.add_argument(
        "--task-dir",
        type=Path,
        required=True,
        help="DevEco task folder (contains graph/com.*.json)",
    )
    parser.add_argument(
        "--graph",
        type=Path,
        default=None,
        help="Override graph json (default: graph/com.*.json first match)",
    )
    parser.add_argument("--scene", type=str, default=None, help="Scene img/layout stem (no ext)")
    parser.add_argument("--image", type=Path, default=None, help="Override screenshot path")
    parser.add_argument("--list-scenes", action="store_true")
    parser.add_argument("--decode", choices=["deveco", "legacy"], default="deveco")
    parser.add_argument("--conf", type=float, default=0.9)
    parser.add_argument("--nms-conf", type=float, default=0.25)
    parser.add_argument("--iou", type=float, default=0.45, help="NMS IoU")
    parser.add_argument("--match-iou", type=float, default=0.5, help="Match threshold")
    parser.add_argument("--max-det", type=int, default=80)
    parser.add_argument("--require-same-class", action="store_true")
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    task_dir = args.task_dir.expanduser()
    if not task_dir.is_dir():
        print(f"task-dir not found: {task_dir}", file=sys.stderr)
        return 1

    graph = args.graph
    if graph is None:
        graphs = list((task_dir / "graph").glob("com.*.json"))
        if not graphs:
            print("No graph/com.*.json under task-dir", file=sys.stderr)
            return 1
        graph = graphs[0]

    scenes = load_graph_scenes(graph)
    if args.list_scenes:
        print(f"graph: {graph}")
        print(f"scenes with widgetBlockList: {len(scenes)}\n")
        for sc in scenes:
            labels = ", ".join({b.class_zh for b in sc.blocks})
            print(
                f"  {sc.img_name.replace('.jpeg', '')}  "
                f"blocks={len(sc.blocks)}  [{labels}]  size={sc.screen_size}"
            )
        return 0

    if not args.scene and not args.image:
        print("Provide --scene <stem> or --image", file=sys.stderr)
        return 1

    scene = find_scene(scenes, img_stem=args.scene, layout_stem=args.scene) if args.scene else None
    if args.scene and scene is None:
        print(f"Scene not found: {args.scene}", file=sys.stderr)
        return 1

    if args.image:
        img_path = args.image
    elif scene:
        img_path = resolve_screenshot(task_dir, scene.img_name)
    else:
        img_path = None

    if not img_path or not img_path.is_file():
        print(f"Screenshot not found: {img_path}", file=sys.stderr)
        return 1

    img = Image.open(img_path)
    img_w, img_h = img.size

    official_blocks = scene.blocks if scene else []
    ref_size = parse_screen_size(scene.screen_size) if scene else None
    if ref_size and (ref_size[0] != img_w or ref_size[1] != img_h):
        fw, fh = ref_size
        official_blocks = [
            DevEcoBlock(
                block_id=ob.block_id,
                class_zh=ob.class_zh,
                class_key=ob.class_key,
                bounds=scale_bounds(ob.bounds, from_w=fw, from_h=fh, to_w=img_w, to_h=img_h),
                text=ob.text,
                xpath=ob.xpath,
            )
            for ob in official_blocks
        ]

    predicted = detect_blocks(
        img_path,
        conf_thres=args.conf,
        iou_thres=args.iou,
        max_det=args.max_det,
        letterbox=True,
        decode_mode=args.decode,
        nms_score_threshold=args.nms_conf,
    )

    result = match_blocks(
        official_blocks,
        predicted,
        iou_thresh=args.match_iou,
        require_same_class=args.require_same_class,
    )

    report = {
        "taskDir": str(task_dir),
        "graph": str(graph),
        "scene": args.scene,
        "image": str(img_path.resolve()),
        "imageSize": [img_w, img_h],
        "screenSizeMeta": scene.screen_size if scene else None,
        "decode": args.decode,
        "thresholds": {"conf": args.conf, "nmsScore": args.nms_conf, "matchIou": args.match_iou},
        "officialCount": len(official_blocks),
        "predCount": len(predicted),
        **result,
    }

    print(f"image: {img_path} ({img_w}x{img_h})")
    if scene:
        print(f"scene: {args.scene}  official blocks: {len(scene.blocks)}")
    print(f"decode: {args.decode}  ONNX detections: {len(predicted)}")
    print(
        f"match @ IoU>={args.match_iou}: {len(result['matches'])}  "
        f"recall={result['recall']:.2f}  precision={result['precision']:.2f}"
    )

    if result["matches"]:
        print("\nMatched:")
        for m in result["matches"]:
            print(
                f"  IOU={m['iou']:.3f}  official={m['officialZh']}  "
                f"pred={m['predZh']} conf={m.get('predConf', 0):.3f}"
            )
    if result["unmatchedOfficial"]:
        print("\nOfficial only (ONNX missed):")
        for u in result["unmatchedOfficial"]:
            print(f"  {u['classZh']} {u['bounds']}")
    if result["unmatchedPred"][:8]:
        print(f"\nONNX only (first {min(8, len(result['unmatchedPred']))}):")
        for u in result["unmatchedPred"][:8]:
            print(f"  {u['classZh']} conf={u.get('conf', 0):.3f} {u['bounds']}")
        if len(result["unmatchedPred"]) > 8:
            print(f"  ... +{len(result['unmatchedPred']) - 8} more")

    out_path = args.out or (ROOT / "output" / "compare" / f"{img_path.stem}_compare.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\njson: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
