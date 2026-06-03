# 探测结果摘要（本机实测）

运行 `python probe_models.py` 与 `python smoke_inference.py` 得到的能力轮廓（**非 DevEco 官方文档**）。

## 1. widget_recognition.onnx（控件识别）

| 项 | 值 |
|----|-----|
| 体积 | ~223 MiB |
| 输入 | `input`: float32 `[1, 3, 224, 224]`（RGB，224×224） |
| 输出 | `output`: float32 `[1, 59]` |
| 结构 | ResNet 类 backbone + `fc` 59 类（全连接分类） |
| 能力推断 | **59 类控件/元素类型分类**（需类别表才能映射到「按钮/输入框」等名称） |

冒烟：随机张量与小红书截图均可 forward，输出 59 维 logits。

**59 类中文标签表**（已对齐）来源：

`~/Library/Application Support/DevEco Testing/common/resources/appSenseToolMain/AppSenseTool/file/config/widget_label.json`

示例（节选）：

| id | 标签 |
|----|------|
| 11 | 关注按钮 |
| 12 | 关闭按钮 |
| 33 | 搜索按钮 |
| 54 | 返回按钮 |
| 13 | 其它 |

完整列表：`python scan_labels.py` 或 `data/widget_label.json`。

**推理脚本**：`infer_widget.py`（整图或 `--crop`）、`batch_infer_layout.py`（按 layout 裁切多控件）。

注意：整屏截图常被判为「其它」；应对单个按钮区域裁图（`batch_infer_layout.py`）才有区分度。

## 2. widget_block_detect_20241019.onnx（区块检测）

| 项 | 值 |
|----|-----|
| 体积 | ~176 MiB |
| 输入 | `images`: float32 `[batch, 3, H, W]`（动态高宽；冒烟用 640×640） |
| 输出 | `output0`: float32 `[batch, 25200, 24]` |
| 结构 | YOLO 风格检测头（大量 Conv，`model.0`…） |
| 能力推断 | **UI 区块/目标检测**（25200 个 anchor，每 anchor 24 维，通常含 box + class + 其它） |

注意：动态尺寸必须用合理 H×W（如 640），不能用 1×1。

**解码**（见 `DEVECO_JAR_REVERSE.md`）：

- JAR 中 `YoloOnnxService`：`objectness≥0.4` → argmax class → xywh2xyxy → scaleCoords → **按类 NMS**（score=objectness，0.25/0.45）
- 当前导出 ONNX 的 `anchor[4]` 几乎恒为 0 → 严格 JAR 解码 **0 框**；probe 用 `block_decode_deveco.py` 的 **class 分数 fallback**
- `legacy`（`block_decode.py`）按 max class 分数筛，易刷屏，仅作对比

**脚本**：

- `verify_image.py` / `run-verify.sh` → **单图验证**（推荐）
- `infer_block.py` → 画框 + JSON（`--decode deveco|legacy`）
- `enrich_cognition_map.py` → 可选写入 cognition-map（**未接入 smart-traverse**）

本机试跑：

- `s1_d0`（隐私长文页）：多框标为「频道列表」
- `s2_d1`：多框标为「底部导航栏」

说明模型能分出**粗粒度 UI 区块**；与 DevEco 完全一致还需对齐训练预处理（letterbox、阈值）。应用时建议与 **UI 树** 交叉验证，勿单独盲信框。

## 3. resnet18_best.onnx（场景分类，名不副实）

| 项 | 值 |
|----|-----|
| 体积 | ~87 MiB |
| 输入 | 多模态：**图像** `input_modal` `[1,3,224,224]` + **文本** `input_ids` / `attention_mask`（变长）+ `modal_start_tokens` / `modal_end_tokens` |
| 输出 | `1305`: float32 `[1, 9]` |
| 结构 | BERT embedding（21128 词表）+ 视觉分支融合 |
| 能力推断 | **9 类场景/页面类型**，且可能结合 OCR/标题等文本（非纯 ResNet18） |

冒烟：仅零填充文本时也能跑通，但**真实效果需要 DevEco 那套 tokenization 与 prompt**，本目录未实现。

---

## 复用建议

| 模型 | 单独复用难度 | 说明 |
|------|--------------|------|
| widget | 中 | 需 ImageNet 式归一化是否与 DevEco 一致待验证；缺 59 类 id→名称表 |
| block | 中高 | 需 NMS + 24 维解码；输入尺寸建议 640 |
| scene | 高 | 必须配套 tokenizer 与文本输入，不能只吃截图 |

后续可在本目录增加 `decode_block_output.py`、类别表猜测等，需更多样本对齐 DevEco 日志。
