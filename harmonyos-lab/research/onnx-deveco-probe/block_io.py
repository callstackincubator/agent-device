"""Run block detector ONNX with letterbox or stretch preprocess."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

from block_decode import decode_predictions, scale_boxes_to_original
from block_decode_deveco import decode_predictions_deveco
from label_sources import load_block_class_keys, load_block_labels
from letterbox import letterbox_image, map_boxes_letterbox_to_original
from model_paths import resolve_paths

INPUT_SIZE = 640


def _stretch_preprocess(img: Image.Image, size: int = INPUT_SIZE) -> tuple[np.ndarray, int, int]:
    orig_w, orig_h = img.size
    resized = img.convert("RGB").resize((size, size), Image.Resampling.BILINEAR)
    arr = np.asarray(resized, dtype=np.float32) / 255.0
    arr = np.transpose(arr, (2, 0, 1))[np.newaxis, ...]
    return arr, orig_w, orig_h


def detect_blocks(
    image_path: Path | str,
    *,
    conf_thres: float = 0.4,
    iou_thres: float = 0.45,
    max_det: int = 20,
    letterbox: bool = True,
    decode_mode: str = "deveco",
    nms_score_threshold: float = 0.25,
    session: ort.InferenceSession | None = None,
) -> list[dict]:
    paths = resolve_paths()
    block_path = paths["block"]
    img = Image.open(image_path)
    class_keys = load_block_class_keys()
    block_zh = load_block_labels()
    num_classes = len(class_keys)

    if session is None:
        session = ort.InferenceSession(str(block_path), providers=["CPUExecutionProvider"])

    if letterbox:
        tensor, scale, (pad_w, pad_h) = letterbox_image(img, INPUT_SIZE)
        orig_w, orig_h = img.size
    else:
        tensor, orig_w, orig_h = _stretch_preprocess(img, INPUT_SIZE)
        scale, pad_w, pad_h = None, 0, 0

    inp_name = session.get_inputs()[0].name
    raw = session.run(None, {inp_name: tensor})[0][0]

    if decode_mode == "deveco":
        if not letterbox:
            raise ValueError("deveco decode requires letterbox=True")
        dets = decode_predictions_deveco(
            raw,
            orig_w=orig_w,
            orig_h=orig_h,
            num_classes=num_classes,
            conf_threshold=conf_thres,
            nms_score_threshold=nms_score_threshold,
            nms_iou_threshold=iou_thres,
            max_det_per_class=max_det,
        )
    else:
        dets = decode_predictions(
            raw,
            num_classes=num_classes,
            conf_thres=conf_thres,
            iou_thres=iou_thres,
            max_det=max_det,
        )
        if letterbox:
            dets = map_boxes_letterbox_to_original(
                dets, scale=scale, pad_w=pad_w, pad_h=pad_h, orig_w=orig_w, orig_h=orig_h
            )
        else:
            dets = scale_boxes_to_original(
                dets, input_size=INPUT_SIZE, orig_w=orig_w, orig_h=orig_h
            )

    enriched: list[dict] = []
    for d in dets:
        x1, y1, x2, y2 = d["xyxy"]
        cid = d["class_id"]
        key = class_keys[cid] if cid < len(class_keys) else "?"
        zh = block_zh.get(key, key)
        cx = (x1 + x2) / 2
        cy = (y1 + y2) / 2
        enriched.append(
            {
                **d,
                "class_id": cid,
                "class_key": key,
                "class_zh": zh,
                "center": {"x": round(cx), "y": round(cy)},
                "area": int(max(0, x2 - x1) * max(0, y2 - y1)),
            }
        )
    return enriched
