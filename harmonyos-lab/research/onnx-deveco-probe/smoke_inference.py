#!/usr/bin/env python3
"""Minimal ONNX Runtime forward pass to verify models load and report output shapes."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

from model_paths import check_paths, resolve_paths


def _parse_shape(shape, defaults: dict[str, int] | None = None) -> list:
    defaults = defaults or {}
    out = []
    for i, d in enumerate(shape):
        if isinstance(d, str) or d is None:
            key = f"dim{i}"
            out.append(defaults.get(key, defaults.get(d, 1)))
        elif int(d) < 0:
            out.append(defaults.get(f"dim{i}", 1))
        else:
            out.append(int(d))
    return out


def _defaults_for_model(model_key: str, meta_name: str, shape: list) -> dict[str, int]:
    """Heuristic sizes when ONNX uses dynamic axes."""
    if model_key == "block" and meta_name == "images":
        return {"dim0": 1, "dim1": 3, "dim2": 640, "dim3": 640, "batch": 1, "height": 640, "width": 640}
    if model_key == "scene":
        if meta_name == "input_modal":
            return {"dim0": 1, "dim1": 3, "dim2": 224, "dim3": 224}
        if meta_name in ("input_ids", "attention_mask"):
            return {"dim0": 1, "dim1": 32, "input_ids_dynamic_axes_1": 32, "attention_mask_dynamic_axes_1": 32}
        if meta_name in ("modal_start_tokens", "modal_end_tokens"):
            return {"dim0": 1}
    if model_key == "widget" and meta_name == "input":
        return {"dim0": 1, "dim1": 3, "dim2": 224, "dim3": 224}
    return {}


def _make_random_input(
    sess: ort.InferenceSession, model_key: str
) -> dict[str, np.ndarray]:
    feeds: dict[str, np.ndarray] = {}
    for meta in sess.get_inputs():
        defaults = _defaults_for_model(model_key, meta.name, meta.shape)
        shape = _parse_shape(meta.shape, defaults)
        if meta.type in ("tensor(int64)", "tensor(int32)"):
            feeds[meta.name] = np.zeros(shape, dtype=np.int32)
        else:
            feeds[meta.name] = np.random.randn(*shape).astype(np.float32)
    return feeds


def _image_to_input(
    sess: ort.InferenceSession, image_path: Path, model_key: str
) -> dict[str, np.ndarray]:
    img = Image.open(image_path).convert("RGB")
    feeds: dict[str, np.ndarray] = {}
    for meta in sess.get_inputs():
        defaults = _defaults_for_model(model_key, meta.name, meta.shape)
        shape = _parse_shape(meta.shape, defaults)
        # NCHW vs NHWC heuristic
        if len(shape) == 4:
            n, c, h, w = shape[0], shape[1], shape[2], shape[3]
            if c in (1, 3) and h > 1 and w > 1:
                resized = img.resize((w, h), Image.Resampling.BILINEAR)
                arr = np.asarray(resized, dtype=np.float32) / 255.0
                if c == 1:
                    arr = arr.mean(axis=2, keepdims=True)
                    arr = np.transpose(arr, (2, 0, 1))
                else:
                    arr = np.transpose(arr, (2, 0, 1))
                arr = arr[np.newaxis, ...]
                feeds[meta.name] = arr.astype(np.float32)
                continue
            if c > 3 and h in (1, 3) and w > h:
                # NHWC
                _, h, w, c = shape
                resized = img.resize((w, h), Image.Resampling.BILINEAR)
                arr = np.asarray(resized, dtype=np.float32) / 255.0
                arr = arr[np.newaxis, ...]
                feeds[meta.name] = arr.astype(np.float32)
                continue
        feeds[meta.name] = _make_random_input(sess, model_key)[meta.name]
    return feeds


def run_one(model_key: str, path: Path, image_path: Path | None) -> None:
    print(f"\n{'=' * 72}")
    print(f"{model_key}: {path.name}")
    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])

    print("Inputs:")
    for meta in sess.get_inputs():
        print(f"  {meta.name}: shape={meta.shape} type={meta.type}")

    if image_path and image_path.is_file():
        print(f"Using image: {image_path}")
        feeds = _image_to_input(sess, image_path, model_key)
    else:
        print("Using random tensor (no --image or file missing)")
        feeds = _make_random_input(sess, model_key)

    for k, v in feeds.items():
        print(f"  feed {k}: shape={v.shape} dtype={v.dtype} min={v.min():.4f} max={v.max():.4f}")

    outputs = sess.run(None, feeds)
    print("Outputs:")
    for meta, out in zip(sess.get_outputs(), outputs):
        flat = out.flatten()
        preview = flat[:8]
        print(
            f"  {meta.name}: shape={out.shape} dtype={out.dtype} "
            f"min={out.min():.4f} max={out.max():.4f} mean={out.mean():.4f} "
            f"preview={preview}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-test DevEco ONNX models")
    parser.add_argument(
        "--models",
        choices=["all", "widget", "block", "scene"],
        default="all",
    )
    parser.add_argument("--image", type=Path, help="Optional screenshot for image-based inputs")
    args = parser.parse_args()

    paths = resolve_paths()
    missing = check_paths(paths)
    if missing:
        print("Missing models:", file=sys.stderr)
        for m in missing:
            print(f"  {m}", file=sys.stderr)
        return 1

    keys = list(paths.keys()) if args.models == "all" else [args.models]
    for key in keys:
        run_one(key, paths[key], args.image)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
