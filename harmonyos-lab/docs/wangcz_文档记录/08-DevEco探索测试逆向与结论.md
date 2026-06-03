# DevEco「应用探索测试」逆向全过程与最终结论

| 项 | 说明 |
|----|------|
| 整理日期 | 2026-05-27 |
| 背景 | 在 agent-device 智能遍历之外，好奇华为 DevEco Testing「应用探索测试」如何工作；尝试用本机 ONNX 复现视觉分区能力 |
| 本机样例任务 | `~/Library/Application Support/DevEco Testing/12189/tasks/33837f41-2639-4e3d-a41f-5c78ffbbe110/`（小红书 `com.xingin.xhs_hos`） |
| 代码产物目录 | 仓库 `onnx-deveco-probe/`（**研究归档，不接入 traverse**） |
| 技术笔记副本 | `onnx-deveco-probe/DEVECO_JAR_REVERSE.md` |

---

## 1. 最初在问什么

1. **UI 树深度**：`dumpLayout` / cognition-map 的 `treeDepth` 是否只有 3 层？→ 已澄清：单屏树深度常 15～60+；「3 层」是 **traverse 界面跳数**（`TRAVERSE_MAX_DEPTH`），见 [07-深度概念与遍历调参.md](./07-深度概念与遍历调参.md)。
2. **静态全量 layout**：能否一次 dump 整 App？→ 不能；需遍历 + 合并（`merge-app-map.js`），见 [06-traverse-output报告生成全流程.md](./06-traverse-output报告生成全流程.md)。
3. **DevEco 智能探索**：应用探索测试里 ONNX / 遍历引擎是什么？能不能借到 agent-device？
4. **ONNX 准不准**：block 检测画框「离谱」——是模型不行还是用错了？

本文记录 **第 3、4 点** 的完整逆向过程与 **可盖章结论**。

---

## 2. 逆向时间线（过程实录）

### 阶段 0：定位 DevEco 资产（本机，未拷入 git）

| 资产 | 典型路径 |
|------|----------|
| 遍历引擎 JAR | `~/Library/Application Support/DevEco Testing/common/resources/traverseEngineCommonJar/6.1/adapter-forApp-traversal-engine-*.jar`（约 600MB，内嵌 onnxruntime + OpenCV） |
| 区块 ONNX | `.../appSenseToolBlockModel/widget_block_detect_20241019.onnx` |
| 控件 ONNX | `.../appSenseToolWidgetModel/widget_recognition.onnx`（输出 59 维） |
| 场景 ONNX | `.../appSenseToolSceneModel/resnet18_best.onnx`（多模态，含 BERT 输入） |
| AppSense 主程序 | `.../appSenseToolMain/`（**pyarmor 加密**，无法直接读 Python） |
| 明文标签 | `appSenseToolMain/AppSenseTool/file/config/widget_label.json`、`block_name.json`、`page_labels.json` → 已复制到 `onnx-deveco-probe/data/` |

探索任务跑完后，任务目录含：

- `graph/com.<包名>.json` — 探索图（节点、动作、场景）
- `graph/screenshot/<hash>.jpeg` — 截图（本任务多为 **1260×2720**）
- `graph/layout/<hash>.json` — 与截图对应的 layout
- `data/.../resources/layout/<timestamp>.json` — 时间戳 layout 存档

### 阶段 1：搭建 `onnx-deveco-probe/`

目的：**不依赖 DevEco 客户端**，用 onnxruntime 探模型 I/O 与最小推理。

| 脚本 | 作用 |
|------|------|
| `probe_models.py` | 打印输入输出 shape |
| `smoke_inference.py` | 随机张量 forward |
| `infer_widget.py` | 整图 / `--crop` 控件 224 分类 |
| `infer_block.py` | block 检测 + 画框 |
| `block_decode.py` | YOLO 风格解码（初版：按 max class 当 conf） |
| `letterbox.py` | 640 letterbox + 坐标反变换 |
| `enrich_cognition_map.py` | 把 block 写入 cognition-map（后已 **脱离 traverse**） |
| `test_onnx_capabilities.py` | 三模型能力冒烟 |

**现象（小红书 `s2_d1` 等屏）**：

- **widget 整图** → 几乎总是「其它」~99.6%（用法错误，应对每个控件 crop）
- **block** → 多个重叠 `menu` 框在屏幕 **上方**、左侧细长 `channel`、conf 经常 1.0
- **scene** → 零填充文本时 top1「登录」无意义

### 阶段 2：接入 smart-traverse（后撤回）

- `smart-traverse-from-cognition.mjs` 曾默认 `TRAVERSE_ONNX_BLOCKS=1`：截图后 `enrich_cognition_map.py`，并按 block 类型滑动。
- 因框不准易 **误导点击/滑动**，已 **完全移除** ONNX 集成；traverse 只保留 `dumpLayout` + `build-cognition-map.js`。
- `scripts/enrich-cognition-onnx.sh` 保留为可选工具，**不接入主流程**。

### 阶段 3：反编译 JAR（`javap`，未脱壳）

关键类：`com.huawei.hitest.apptester.xtester.ai.utils.YoloOnnxService`

| 步骤 | JAR 行为 |
|------|----------|
| 读图 | OpenCV `imread` → `cvtColor` 转 RGB |
| 预处理 | `Letterbox` 640×640，padding **114**，`/255`，NCHW |
| 推理 | `OrtSession`，输入名通常 `images`，输出 `[1, 25200, 24]` |
| 筛 anchor | **`pred[4] >= 0.4`（objectness）** |
| 分类 | `argmax(pred[5:5+19])` |
| 几何 | `xywh2xyxy` → `scaleCoords` 回原图 |
| NMS | **按类别**，分数用 **objectness**，score_thresh **0.25**，IoU **0.45** |

其它相关类：

- `WidgetOnnxUtils` — 另一套检测/阈值，勿与 block 混淆
- `WidgetBlockUtils` / `WidgetBlockManager` — block 与 **layout、DeepView、底栏策略** 融合，不是纯视觉框

### 阶段 4：对齐 JAR 后仍对不上的实验

对 `widget_block_detect_20241019.onnx` 统计 raw 输出：

- `pred[4]`（objectness）：**max ≈ 0.04**，无 anchor ≥ 0.4
- `pred[5:]`：已在 0～1，大量为 1.0

→ **严格按 JAR 解码 → 0 个检测框**（与「探索测试里有合理区块」矛盾）

→ 说明：**探索任务里的 `widgetBlockList` ≠ 裸 ONNX + YoloOnnxService 的直接输出**（还有 AppSense / 融合）。

实现 `block_decode_deveco.py`：objectness 全失败时 **fallback 用 max(class_prob)** 仅便于对比；标注为 export-adapted，非字节码等价。

### 阶段 5：与官方 `widgetBlockList` 对照（结案实验）

从 `graph/com.xingin.xhs_hos.json` 解析：

- 每个 `exactScenes[]` 含 `widgetBlockList`（dict：`widgetLabel`、`bounds`、`xpath`、`text`）
- 本任务共 **50** 个带官方区块的场景

工具：`compare_deveco_onnx.py` + `deveco_task_io.py`

**样例屏 `DD1862C5CF8F346DBB265FF3E531D962`（1260×2720，与 DevEco 截图一致）**

| 官方块 | bounds（约） |
|--------|----------------|
| 底部导航栏 | `[0,2486][1260,2720]` |
| 频道列表 | `[343,124][918,265]` |
| 内容列表区 | `[7,268][1256,2506]` |

| ONNX 模式 | 检测数 | IoU 匹配 |
|-----------|--------|----------|
| deveco, conf=0.9 | 1 | 0（≥0.5） |
| deveco, conf=0.5 | 3 | 0（≥0.3 仍无） |
| legacy, conf=0.5 | 19 | IoU≥0.3 时 3/3 **有空间重叠**，但 **类名经常对错**（如官方「频道」↔ 预测「底栏」） |

**本机探索任务规模（说明「产品能跑」）**：

| 指标 | 值 |
|------|-----|
| `reachedPages` | 89 |
| `numActions` | 603 |
| `numExactScenes` | 45 |
| `nodes` | 44 |

---

## 3. 最终结论（盖章版）

### A. DevEco「应用探索测试」作为产品 — **行**

在你本机对小红书的一次任务中，能自动产生 **89 界面 / 603 动作** 的探索图与报告素材；`widgetBlockList` 的 bounds 与中文标签 **大体符合肉眼布局**（如底栏在底部、频道在顶部）。

**判定**：在 DevEco 封闭环境（设备 + layout + 引擎 + AppSense）下，**这套能力可用**，不是空壳。

### B. 抠出来的 block ONNX 单独使用 — **不行（不能当 ground truth）**

- 与官方 `widgetBlockList` **对不齐**（空间 + 语义）
- 与 JAR 内 `YoloOnnxService` 假设的 objectness 门限 **不一致**（导出模型 anchor[4]≈0）
- 整图 widget / 零文本 scene **不能代表真实用法**

**判定**：之前「框离谱」**不主要是命令跑错**，而是 **「单列 ONNX ≠ DevEco 所见」**；调参无法合理追到「官方同款」。

### C. agent-device 主路 — **没有走错**

- 可靠数据：**`uitest dumpLayout` → UI 树**（text、bounds、clickable）
- **smart-traverse + cognition-map** = 开放、可解释、可接 agent
- **不应**用 block ONNX 驱动 traverse（已从脚本移除）

**判定**：与 DevEco 是 **两种架构**（封闭全家桶 vs 开放 CLI），不是「谁替谁」。

### D. 本仓库 `onnx-deveco-probe/` — **研究归档，不必再投**

已弄清的问题，以后无需重复怀疑：

| 问题 | 答案 |
|------|------|
| ONNX 能 forward 吗？ | 能 |
| 单图能当分区 ground truth 吗？ | **不能** |
| DevEco 探索能跑吗？ | **能**（有任务数据） |
| 值得继续反编 pyarmor 复刻吗？ | **除非立项做 DevEco 竞品，否则不值** |

---

## 4. 一句话结案

> **DevEco 探索测试：产品层面行；视觉 ONNX 单独拿出来不行、也不是它的核心；agent-device 应坚持 layout 遍历，别用 ONNX 证明自己。**

三句同时为真，不矛盾。

---

## 5. 心理层面：为何曾觉得「没结论」

混在一起了三个不同问题：

| # | 问题 | 应有结论 |
|---|------|----------|
| 1 | 华为产品好不好？ | **能用，本机跑通** |
| 2 | 模型准不准？ | **单独不准，不必再调** |
| 3 | 我们能否做出一样的东西？ | **不能靠抠 ONNX；克隆=整条链，另一项目** |

不甘心常来自 **问题 3**，结案应落在 **问题 1 + 2**。

---

## 6. 架构对照（帮助收束）

```text
DevEco 应用探索测试（封闭）
  设备 + hdc/uitest
  → dumpLayout + 截图 (1260×2720)
  → appexploratory JAR (遍历引擎、点击策略、WidgetBlockManager)
  → AppSense Python (加密): widget/block/scene 融合
  → graph/com.*.json (widgetBlockList、动作、场景)
  → HTML 报告 / 导出

agent-device 智能遍历（开放）
  agent-device session + hdc
  → dumpLayout (可能另一分辨率，如 2224×2496)
  → build-cognition-map.js (规则 + layout 树)
  → smart-traverse (坐标点击、护栏、报告)
  → traverse-output/*-smart-v3/
```

**不要混用坐标系**：DevEco 官方 block 对比必须用 `graph/screenshot/*.jpeg`，不要用 agent-device 的 PNG 直接比 IOU。

---

## 7. 仓库内工具索引（日后只查这里）

```bash
cd onnx-deveco-probe
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# 单图验证
./run-verify.sh /path/to/screen.png --decode deveco

# 与 DevEco 官方 block 对比（需 task 目录 + scene hash）
TASK="$HOME/Library/Application Support/DevEco Testing/12189/tasks/33837f41-..."
./run-compare.sh --task-dir "$TASK" --list-scenes
./run-compare.sh --task-dir "$TASK" --scene DD1862C5CF8F346DBB265FF3E531D962 --decode legacy --match-iou 0.3
```

| 路径 | 说明 |
|------|------|
| `onnx-deveco-probe/README.md` | 使用说明 |
| `onnx-deveco-probe/DEVECO_JAR_REVERSE.md` | JAR 反编译技术摘要 |
| `onnx-deveco-probe/compare_deveco_onnx.py` | 官方 vs ONNX IOU |
| `scripts/smart-traverse-from-cognition.mjs` | **已无 ONNX** |
| [06-traverse-output报告生成全流程.md](./06-traverse-output报告生成全流程.md) | 我方 traverse 主流程 |

---

## 8. 建议的后续（主路）

1. 用 **smart-traverse 报告** 评判质量：真新屏、少 recover、少错包（见 [06](./06-traverse-output报告生成全流程.md)、[07](./07-深度概念与遍历调参.md)）。
2. 弹窗/精点继续用 **`snapshot -i` + label/ref**（见 [05](./05-实操案例-登录与弹窗.md)）。
3. **不再**为「复现 DevEco ONNX」投入；若需肉眼结案 DevEco 产品本身：打开该任务的 **HTML 报告** 翻 10 屏即可，无需再跑模型。

---

## 9. 相关对话与产物

- 对话中产生的可视化：`onnx-deveco-probe/output/*_blocks.png`、`output/verify/`、`output/compare/`
- traverse 样例：`traverse-output/xhs-smart-v3/` 等（与 DevEco 分辨率可能不同）

**文档状态**：本章为 DevEco 逆向的 **收束记录**；若只关心日常开发，读到 **第 3、4 节** 即可。
