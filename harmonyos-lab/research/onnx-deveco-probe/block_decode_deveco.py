"""Decode block ONNX output to match DevEco YoloOnnxService (jar reverse-engineered).

Reference: com.huawei.hitest.apptester.xtester.ai.utils.YoloOnnxService
  - confThreshold=0.4 on anchor[4] (objectness)
  - argmax on anchor[5:5+num_classes]
  - xywh -> xyxy in 640 letterbox space
  - scaleCoords back to original image
  - per-class NMS: score=anchor[4], score_thresh=0.25, iou=0.45

Note: exported widget_block_detect ONNX often has anchor[4] ~ 0; use objectness_fallback
when no anchors pass the objectness gate.
"""

from __future__ import annotations

import numpy as np

from block_decode import box_iou, nms_xyxy, sigmoid


def xywh_to_xyxy(boxes: np.ndarray) -> np.ndarray:
    """cx,cy,w,h -> x1,y1,x2,y2 (in-place on copy)."""
    out = boxes.copy()
    cx, cy, w, h = out[:, 0], out[:, 1], out[:, 2], out[:, 3]
    out[:, 0] = cx - w / 2
    out[:, 1] = cy - h / 2
    out[:, 2] = cx + w / 2
    out[:, 3] = cy + h / 2
    return out


def scale_coords_xyxy(
    xyxy: np.ndarray,
    *,
    orig_w: int,
    orig_h: int,
    input_size: int = 640,
) -> np.ndarray:
    """Match YoloOnnxService.scaleCoords (letterbox inverse, clamp to image)."""
    gain = min(input_size / orig_w, input_size / orig_h)
    pad_w = (input_size - orig_w * gain) / 2
    pad_h = (input_size - orig_h * gain) / 2
    out = xyxy.copy()
    out[:, [0, 2]] = (out[:, [0, 2]] - pad_w) / gain
    out[:, [1, 3]] = (out[:, [1, 3]] - pad_h) / gain
    out[:, [0, 2]] = np.clip(out[:, [0, 2]], 0, orig_w - 1)
    out[:, [1, 3]] = np.clip(out[:, [1, 3]], 0, orig_h - 1)
    return out


def decode_predictions_deveco(
    pred: np.ndarray,
    *,
    orig_w: int,
    orig_h: int,
    num_classes: int = 19,
    conf_threshold: float = 0.4,
    nms_score_threshold: float = 0.25,
    nms_iou_threshold: float = 0.45,
    max_det_per_class: int = 50,
    objectness_fallback: bool = True,
    apply_sigmoid_obj: bool = False,
    apply_sigmoid_cls: bool = False,
) -> list[dict]:
    """
    pred: (num_anchors, 4 + 1 + num_classes) in 640 letterbox pixel space.
    """
    if pred.ndim != 2 or pred.shape[1] < 5 + num_classes:
        raise ValueError(f"unexpected pred shape {pred.shape}")

    boxes_xywh = pred[:, :4].astype(np.float32)
    obj = pred[:, 4]
    cls = pred[:, 5 : 5 + num_classes]

    if apply_sigmoid_obj:
        obj = sigmoid(obj)
    if apply_sigmoid_cls:
        cls = sigmoid(cls)

    cls_id = np.argmax(cls, axis=1)
    cls_conf = cls[np.arange(cls.shape[0]), cls_id]

    used_cls_fallback = False
    mask = obj >= conf_threshold
    if objectness_fallback and not np.any(mask):
        mask = cls_conf >= conf_threshold
        used_cls_fallback = True

    if not np.any(mask):
        return []

    boxes_xywh = boxes_xywh[mask]
    obj = obj[mask]
    cls_id = cls_id[mask]
    cls_conf = cls_conf[mask]
    nms_scores = cls_conf if used_cls_fallback else obj

    xyxy = xywh_to_xyxy(boxes_xywh)
    valid = (xyxy[:, 0] < xyxy[:, 2]) & (xyxy[:, 1] < xyxy[:, 3])
    if not np.any(valid):
        return []

    xyxy = xyxy[valid]
    obj = obj[valid]
    cls_id = cls_id[valid]
    cls_conf = cls_conf[valid]

    xyxy = scale_coords_xyxy(xyxy, orig_w=orig_w, orig_h=orig_h)

    min_side = 8
    size_ok = (xyxy[:, 2] - xyxy[:, 0] >= min_side) & (xyxy[:, 3] - xyxy[:, 1] >= min_side)
    if not np.any(size_ok):
        return []
    xyxy = xyxy[size_ok]
    nms_scores = nms_scores[size_ok]
    obj = obj[size_ok]
    cls_id = cls_id[size_ok]
    cls_conf = cls_conf[size_ok]

    by_class: dict[int, list[dict]] = {}
    for i in range(len(xyxy)):
        cid = int(cls_id[i])
        by_class.setdefault(cid, []).append(
            {
                "xyxy": xyxy[i].tolist(),
                "conf": float(nms_scores[i]),
                "cls_conf": float(cls_conf[i]),
                "objectness": float(obj[i]),
                "class_id": cid,
            }
        )

    merged: list[dict] = []
    for cid, dets in by_class.items():
        if not dets:
            continue
        boxes = np.array([d["xyxy"] for d in dets], dtype=np.float32)
        scores = np.array([d["conf"] for d in dets], dtype=np.float32)
        keep = nms_xyxy(
            boxes,
            scores,
            iou_thres=nms_iou_threshold,
            max_det=max_det_per_class,
        )
        score_mask = scores >= nms_score_threshold
        for idx in keep:
            if not score_mask[idx]:
                continue
            merged.append(dets[idx])

    merged.sort(key=lambda d: -d["conf"])
    return merged[: max_det_per_class * num_classes]
