"""Decode YOLO-style block detector output [N, 24] -> boxes.

Heuristic layout (19 block classes in block_name.json):
  [cx, cy, w, h, objectness, class_scores x 19]
"""

from __future__ import annotations

import numpy as np


def sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(x, -50, 50)))


def decode_predictions(
    pred: np.ndarray,
    *,
    num_classes: int = 19,
    conf_thres: float = 0.25,
    iou_thres: float = 0.45,
    max_det: int = 50,
    apply_sigmoid_obj: bool = False,
    apply_sigmoid_cls: bool = False,
    use_objectness: bool = False,
) -> list[dict]:
    """
    pred: (num_anchors, 24) raw ONNX output for one image.
    Returns list of dicts: xyxy (input pixels), conf, class_id, class_key optional.
    """
    if pred.ndim != 2 or pred.shape[1] < 5 + num_classes:
        raise ValueError(f"unexpected pred shape {pred.shape}")

    boxes = pred[:, :4].astype(np.float32)
    obj = pred[:, 4]
    cls = pred[:, 5 : 5 + num_classes]

    if apply_sigmoid_obj:
        obj = sigmoid(obj)
    if apply_sigmoid_cls:
        cls = sigmoid(cls)

    cls_id = np.argmax(cls, axis=1)
    cls_conf = cls[np.arange(cls.shape[0]), cls_id]
    if use_objectness:
        conf = obj * cls_conf
    else:
        conf = cls_conf

    mask = conf >= conf_thres
    if not np.any(mask):
        return []

    boxes = boxes[mask]
    conf = conf[mask]
    cls_id = cls_id[mask]

    # cx,cy,w,h -> xyxy
    cx, cy, w, h = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    x1 = cx - w / 2
    y1 = cy - h / 2
    x2 = cx + w / 2
    y2 = cy + h / 2
    xyxy = np.stack([x1, y1, x2, y2], axis=1)

    keep = nms_xyxy(xyxy, conf, iou_thres=iou_thres, max_det=max_det)
    out: list[dict] = []
    for i in keep:
        out.append(
            {
                "xyxy": xyxy[i].tolist(),
                "conf": float(conf[i]),
                "class_id": int(cls_id[i]),
            }
        )
    return out


def nms_xyxy(
    boxes: np.ndarray,
    scores: np.ndarray,
    *,
    iou_thres: float = 0.45,
    max_det: int = 50,
) -> list[int]:
    if len(boxes) == 0:
        return []
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size > 0 and len(keep) < max_det:
        i = int(order[0])
        keep.append(i)
        if order.size == 1:
            break
        rest = order[1:]
        ious = box_iou(boxes[i], boxes[rest])
        order = rest[ious <= iou_thres]
    return keep


def box_iou(box: np.ndarray, boxes: np.ndarray) -> np.ndarray:
    x1 = np.maximum(box[0], boxes[:, 0])
    y1 = np.maximum(box[1], boxes[:, 1])
    x2 = np.minimum(box[2], boxes[:, 2])
    y2 = np.minimum(box[3], boxes[:, 3])
    inter = np.maximum(0, x2 - x1) * np.maximum(0, y2 - y1)
    area1 = (box[2] - box[0]) * (box[3] - box[1])
    area2 = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    union = area1 + area2 - inter + 1e-6
    return inter / union


def scale_boxes_to_original(
    detections: list[dict],
    *,
    input_size: int,
    orig_w: int,
    orig_h: int,
) -> list[dict]:
    """Scale xyxy from letterbox/squash input coords to original image size."""
    sx = orig_w / input_size
    sy = orig_h / input_size
    scaled = []
    for d in detections:
        x1, y1, x2, y2 = d["xyxy"]
        scaled.append(
            {
                **d,
                "xyxy": [x1 * sx, y1 * sy, x2 * sx, y2 * sy],
            }
        )
    return scaled
