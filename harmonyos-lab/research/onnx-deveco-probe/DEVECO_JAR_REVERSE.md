# DevEco 遍历引擎 JAR 反编译笔记（ONNX 相关）

来源：`~/Library/Application Support/DevEco Testing/common/resources/traverseEngineCommonJar/6.1/adapter-forApp-traversal-engine-*.jar`

工具：`javap -c -p`（未改包、未脱壳）

## 1. Block 检测：`YoloOnnxService`

类路径：`com.huawei.hitest.apptester.xtester.ai.utils.YoloOnnxService`

### 默认阈值

| 字段 | 默认值 | 用途 |
|------|--------|------|
| `confThreshold` | **0.4** | 过滤 `anchor[4]`（objectness） |
| `numThreshold` | **0.45** | NMS IoU |
| `scoreThreshold` | **0.25** | NMS 分数门限 |
| `INPUT_SIZE` | **640** | 输入边长 |

### 预处理流水线

1. `Imgcodecs.imread` 读图
2. `cvtColor(..., 4)` → RGB
3. `Letterbox`：640×640，padding **(114,114,114)**，`scaleUp=true`，`stride=32`
4. `getPixels`：NCHW，`pixel / 255.0`（与 OpenCV 通道顺序一致）

### 后处理 `getClass2Bbox`

对每个 anchor（长度 = 4 + 1 + num_classes）：

1. 若 `pred[4] < confThreshold(0.4)` → 丢弃
2. `argmax(pred[5:])` 得类别
3. `xywh2xyxy`：`x1=cx-w/2, y1=cy-h/2, x2=cx+w/2, y2=cy+h/2`（**640 坐标系**）
4. `scaleCoords`：按 letterbox 反变换到**原图**尺寸并 clamp

### NMS `getDetections`

- **按类别分组** NMS（OpenCV `Dnn.NMSBoxes`）
- NMS 分数 = **`anchor[4]`（objectness）**，不是 class 概率
- `scoreThreshold=0.25`，`numThreshold=0.45`

### 与本仓库 ONNX 导出的差异（重要）

对 `widget_block_detect_20241019.onnx` 实测：

- `pred[4]`（objectness）**几乎全为 0**（max ≈ 0.04），**没有任何 anchor 能通过 0.4 门限**
- `pred[5:]` 已是 **0～1 概率**，很多为 **1.0**

因此：

- **严格按 JAR 解码 → 0 个框**（除非换模型或图内 objectness 分布不同）
- 探索测试产出的 `Layout.widgetBlockList` 更可能来自 **AppSense Python（pyarmor）** 或其它融合路径，不能假定等于裸跑 `YoloOnnxService`

本仓库 `block_decode_deveco.py` 在 objectness 全失败时增加 **`objectness_fallback`**：改用 `max(class_prob) >= conf` 筛 anchor，便于单图对比；**标注为 export-adapted，非 100% 字节码等价**。

## 2. 控件识别：`WidgetOnnxUtils`

- 输入名 `images`，从 metadata 读 `names`
- 同样有 `CONF_THRESHOLD` / `NMS_THRESHOLD`（另一套检测逻辑，勿与 block 混淆）
- **widget 分类** 请用 `infer_widget.py`：**按 layout bounds 裁切** + ImageNet 归一化 + 224×224

## 3. 引擎内 Block 用法：`WidgetBlockUtils` / `WidgetBlockManager`

- Block 与 **layout 树、DeepView、语义覆盖** 聚合，不是「只画框就遍历」
- `WidgetBlockManager` 维护底栏 `menu`、频道等 **业务策略**，与纯 ONNX 输出不同层

## 4. 推荐单图验证命令

```bash
cd onnx-deveco-probe
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# DevEco 风格解码（objectness 失败时自动 fallback）
.venv/bin/python verify_image.py /path/to/screen.png --decode deveco --conf 0.4

# 对比旧逻辑（按 max class 分数，易刷屏）
.venv/bin/python verify_image.py /path/to/screen.png --decode legacy --conf 0.5

# 同一屏 layout + widget 裁切
.venv/bin/python verify_image.py screen.png --layout ../traverse-output/.../layouts/s2_d1.json
```

输出：`output/verify/<stem>_verify_blocks.png` + `<stem>_verify.json`

## 5. 官方区块 vs ONNX：`compare_deveco_onnx.py`

DevEco 任务 `graph/com.*.json` 里每个 `exactScene` 有 **`widgetBlockList`**（中文 `widgetLabel` + `bounds`），截图在 `graph/screenshot/<hash>.jpeg`（通常 **1260×2720**）。

```bash
TASK="$HOME/Library/Application Support/DevEco Testing/12189/tasks/<task-uuid>"

# 列出带官方区块的屏
.venv/bin/python compare_deveco_onnx.py --task-dir "$TASK" --list-scenes

# 与 ONNX 对比（必须用 DevEco 同一张 jpeg，不要用 agent-device 截的 2224×2496）
.venv/bin/python compare_deveco_onnx.py \
  --task-dir "$TASK" \
  --scene DD1862C5CF8F346DBB265FF3E531D962 \
  --decode deveco --conf 0.5 --match-iou 0.3
```

### 实测（小红书探索任务 DD1862 屏）

| 来源 | 结果 |
|------|------|
| 官方 `widgetBlockList` | 3 块：底栏、顶频道、内容列表 |
| ONNX `deveco` + conf 0.9 | 1 框，**0** 个 IoU≥0.5 匹配 |
| ONNX `legacy` + conf 0.5 | 19 框；IoU≥0.3 时 **3/3 有空间重叠**，但 **类别常对错**（如官方「频道」↔ 预测「底栏」） |

结论：**官方区块 ≠ 裸 ONNX 输出**；空间上 legacy 偶尔贴近，语义上仍不可直接当 ground truth 对齐 ONNX。

报告 JSON：`output/compare/<scene>_compare.json`

## 6. 与 smart-traverse 的关系

**`scripts/smart-traverse-from-cognition.mjs` 已不再调用 ONNX。** 遍历仅依赖 `dumpLayout` + `build-cognition-map.js`。
