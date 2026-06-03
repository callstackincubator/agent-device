#!/usr/bin/env python3
"""
单元测试 / 能力演示：给定截图，三个 ONNX 各返回什么。

模型文件默认不放在仓库里，读取本机 DevEco 下载路径（见 model_paths.py）。
仅拷贝了标签 JSON：data/widget_label.json、data/block_name.json、data/page_labels.json

用法:
  cd onnx-deveco-probe && source .venv/bin/activate
  python test_onnx_capabilities.py
  python test_onnx_capabilities.py --image /path/to/screen.png
  python test_onnx_capabilities.py --json   # 只打印 JSON
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import numpy as np
    import onnxruntime as ort
except ImportError as e:
    print(
        "缺少依赖。请使用 onnx-deveco-probe 虚拟环境，不要直接用系统 python3：\n"
        "  cd onnx-deveco-probe\n"
        "  python3 -m venv .venv\n"
        "  source .venv/bin/activate\n"
        "  pip install -r requirements.txt\n"
        "  python test_onnx_capabilities.py --image <截图.png>\n",
        file=sys.stderr,
    )
    raise SystemExit(1) from e
from PIL import Image

from block_io import detect_blocks
from infer_widget import infer, load_labels, preprocess, softmax
from label_sources import load_block_class_keys, load_scene_labels
from model_paths import check_paths, resolve_paths

ROOT = Path(__file__).resolve().parent
DEFAULT_IMAGE = ROOT.parent / "traverse-output/xhs-smart-v3/screens/s2_d1.png"


def _models_manifest() -> dict:
    paths = resolve_paths()
    missing = check_paths(paths)
    bundled_labels = {
        "widget59": str(ROOT / "data/widget_label.json"),
        "block19": str(ROOT / "data/block_name.json"),
        "scene9": str(ROOT / "data/page_labels.json"),
    }
    models = {}
    for key, p in paths.items():
        models[key] = {
            "path": str(p),
            "exists": p.is_file(),
            "sizeMb": round(p.stat().st_size / (1024 * 1024), 2) if p.is_file() else None,
            "inRepo": False,
        }
    return {
        "note": "ONNX 权重未提交到 git；脚本运行时从 DevEco 目录读取",
        "bundledInRepo": bundled_labels,
        "models": models,
        "allModelsPresent": len(missing) == 0,
        "missing": missing,
    }


def run_widget(image: Path, top_k: int = 5) -> dict:
    paths = resolve_paths()
    labels = load_labels(None)
    sess = ort.InferenceSession(str(paths["widget"]), providers=["CPUExecutionProvider"])
    img = Image.open(image)
    for norm in ("imagenet", "zero_one"):
        tensor = preprocess(img, norm)
        logits = infer(sess, tensor)
        probs = softmax(logits)
        order = np.argsort(probs)[::-1][:top_k]
        top = [
            {
                "rank": i + 1,
                "classId": int(idx),
                "labelZh": labels[int(idx)] if int(idx) < len(labels) else None,
                "probability": round(float(probs[idx]), 6),
                "logit": round(float(logits[idx]), 4),
            }
            for i, idx in enumerate(order)
        ]
        if norm == "imagenet":
            return {
                "model": "widget_recognition.onnx",
                "input": {"name": "input", "shape": [1, 3, 224, 224], "norm": "imagenet"},
                "output": {"name": "output", "shape": [1, 59], "meaning": "59 类控件 logits"},
                "interpretation": "整图 resize 到 224；top-1 为模型认为最像的控件类型（裁切单按钮会更准）",
                "topK": top,
            }
    raise RuntimeError("unreachable")


def run_block(image: Path, max_det: int = 8) -> dict:
    dets = detect_blocks(image, conf_thres=0.5, max_det=max_det, letterbox=True)
    return {
        "model": "widget_block_detect_20241019.onnx",
        "input": {"name": "images", "shape": "[1,3,640,640]", "preprocess": "letterbox"},
        "output": {"name": "output0", "shape": "[1, 25200, 24]", "meaning": "YOLO anchors"},
        "interpretation": "返回 0～max_det 个 UI 区块框 + 19 类之一（搜索区/列表/底栏…）",
        "detectionCount": len(dets),
        "detections": [
            {
                "classKey": d["class_key"],
                "classZh": d["class_zh"],
                "confidence": round(d["conf"], 4),
                "bboxPx": {k: round(v) for k, v in zip(["x1", "y1", "x2", "y2"], d["xyxy"])},
                "center": d["center"],
            }
            for d in dets
        ],
    }


def run_scene_smoke(image: Path) -> dict:
    """Scene 需 BERT 文本输入；此处仅演示张量形状与 9 类 logits（文本填零，结果无业务意义）。"""
    paths = resolve_paths()
    scene_names, _ = load_scene_labels()
    sess = ort.InferenceSession(str(paths["scene"]), providers=["CPUExecutionProvider"])
    img = Image.open(image).convert("RGB").resize((224, 224), Image.Resampling.BILINEAR)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    modal = np.transpose(arr, (2, 0, 1))[np.newaxis, ...]

    feeds = {
        "input_ids": np.zeros((1, 32), dtype=np.int32),
        "input_modal": modal.astype(np.float32),
        "attention_mask": np.zeros((1, 32), dtype=np.int32),
        "modal_start_tokens": np.zeros((1,), dtype=np.int32),
        "modal_end_tokens": np.zeros((1,), dtype=np.int32),
    }
    out = sess.run(None, feeds)[0][0]
    probs = np.exp(out - out.max())
    probs = probs / probs.sum()
    idx = int(np.argmax(probs))
    return {
        "model": "resnet18_best.onnx",
        "input": {
            "input_modal": [1, 3, 224, 224],
            "input_ids": [1, 32],
            "attention_mask": [1, 32],
            "modal_start_tokens": [1],
            "modal_end_tokens": [1],
        },
        "output": {"name": "1305", "shape": [1, 9], "meaning": "9 类页面场景 logits"},
        "interpretation": "多模态；此处文本为零填充，仅验证能 forward，top-1 不可当作真实场景",
        "sceneLabels": scene_names,
        "top1": {
            "classId": idx,
            "labelZh": scene_names[idx] if idx < len(scene_names) else None,
            "probability": round(float(probs[idx]), 6),
        },
        "allClasses": [
            {"classId": i, "labelZh": scene_names[i], "logit": round(float(out[i]), 4)}
            for i in range(len(scene_names))
        ],
    }


def run_all(image: Path) -> dict:
    manifest = _models_manifest()
    if not manifest["allModelsPresent"]:
        return {"manifest": manifest, "error": "models_missing", "tests": {}}

    return {
        "manifest": manifest,
        "image": str(image.resolve()),
        "imageSize": list(Image.open(image).size),
        "tests": {
            "widget": run_widget(image),
            "block": run_block(image),
            "scene_smoke": run_scene_smoke(image),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", type=Path, default=DEFAULT_IMAGE)
    parser.add_argument("--json", action="store_true", help="Only print JSON")
    args = parser.parse_args()

    if not args.image.is_file():
        print(f"测试图不存在: {args.image}", file=sys.stderr)
        print("请指定 --image 或先跑 smart-traverse 生成 screens/*.png", file=sys.stderr)
        return 1

    report = run_all(args.image)

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        m = report["manifest"]
        print("=== 1. ONNX 文件是否在仓库里？ ===")
        print("  否。仓库里只有标签 JSON（data/*.json），模型在本机 DevEco 目录：")
        for key, info in m["models"].items():
            flag = "OK" if info["exists"] else "缺失"
            print(f"  [{flag}] {key}: {info['path']} ({info.get('sizeMb')} MiB)")
        if m["missing"]:
            print("  请先在本机 DevEco 跑一次「应用探索测试」以下载模型")
            return 1

        print(f"\n=== 2. 测试图 ===\n  {report['image']}\n  size={report['imageSize']}")

        w = report["tests"]["widget"]
        print("\n=== 3. widget_recognition（给定截图 → 59 维 → top-K 中文类名）===")
        print(f"  输入: {w['input']}")
        print(f"  输出: {w['output']}")
        for row in w["topK"]:
            print(f"    #{row['rank']} id={row['classId']} {row['labelZh']} p={row['probability']}")

        b = report["tests"]["block"]
        print("\n=== 4. block_detect（给定截图 → 多个框 + 区块类型）===")
        print(f"  检测到 {b['detectionCount']} 个框（conf>=0.5, letterbox）")
        for d in b["detections"][:6]:
            print(f"    {d['classZh']} conf={d['confidence']} center=({d['center']['x']},{d['center']['y']})")

        s = report["tests"]["scene_smoke"]
        print("\n=== 5. scene（9 类，需图文；此处为零文本 smoke）===")
        print(f"  top1（仅供参考）: {s['top1']}")
        print(f"  9 类名: {s['sceneLabels']}")

    return 0 if report.get("tests") else 1


if __name__ == "__main__":
    raise SystemExit(main())
