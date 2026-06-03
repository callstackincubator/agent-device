"""Letterbox resize for YOLO-style detectors (640 input)."""

from __future__ import annotations

import numpy as np
from PIL import Image

Color = tuple[int, int, int]


def letterbox_image(
    img: Image.Image,
    size: int = 640,
    color: Color = (114, 114, 114),
) -> tuple[np.ndarray, float, tuple[int, int]]:
    """
    Returns CHW float32 [1,3,H,W] in 0..1, scale ratio, (pad_w, pad_h).
    """
    img = img.convert("RGB")
    orig_w, orig_h = img.size
    scale = min(size / orig_w, size / orig_h)
    new_w = int(round(orig_w * scale))
    new_h = int(round(orig_h * scale))
    resized = img.resize((new_w, new_h), Image.Resampling.BILINEAR)

    pad_w = (size - new_w) // 2
    pad_h = (size - new_h) // 2
    canvas = Image.new("RGB", (size, size), color)
    canvas.paste(resized, (pad_w, pad_h))

    arr = np.asarray(canvas, dtype=np.float32) / 255.0
    arr = np.transpose(arr, (2, 0, 1))[np.newaxis, ...]
    return arr, scale, (pad_w, pad_h)


def map_boxes_letterbox_to_original(
    detections: list[dict],
    *,
    scale: float,
    pad_w: int,
    pad_h: int,
    orig_w: int,
    orig_h: int,
) -> list[dict]:
    """Map xyxy from letterboxed 640 space to original image pixels."""
    out = []
    for d in detections:
        x1, y1, x2, y2 = d["xyxy"]
        x1 = (x1 - pad_w) / scale
        y1 = (y1 - pad_h) / scale
        x2 = (x2 - pad_w) / scale
        y2 = (y2 - pad_h) / scale
        x1 = max(0.0, min(float(orig_w), x1))
        y1 = max(0.0, min(float(orig_h), y1))
        x2 = max(0.0, min(float(orig_w), x2))
        y2 = max(0.0, min(float(orig_h), y2))
        if x2 - x1 < 8 or y2 - y1 < 8:
            continue
        out.append({**d, "xyxy": [x1, y1, x2, y2]})
    return out
