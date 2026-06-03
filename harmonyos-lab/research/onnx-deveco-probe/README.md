# DevEco ONNX 模型探测

单独目录，用于探测 DevEco Testing 下载的 ONNX 模型**结构**与**最小推理**（不依赖 DevEco 客户端）。

## 模型来源（本机默认路径）

需先在 DevEco 里跑过一次「应用探索测试」，才会下载这些资源：

| 模型 | 默认路径 |
|------|----------|
| 控件识别 | `~/Library/Application Support/DevEco Testing/common/resources/appSenseToolWidgetModel/widget_recognition.onnx` |
| 区块检测 | `~/Library/Application Support/DevEco Testing/common/resources/appSenseToolBlockModel/widget_block_detect_20241019.onnx` |
| 场景分类 | `~/Library/Application Support/DevEco Testing/common/resources/appSenseToolSceneModel/resnet18_best.onnx` |

可通过环境变量覆盖，见 `paths.env.example`。

## 模型文件有没有拷进仓库？

**没有。** 三个 `.onnx` 体积约 220MB + 176MB + 87MB，仍在 DevEco 本机目录（见 `model_paths.py`）。  
仓库里只提交了 **标签表** 副本：`data/widget_label.json`（59 类）、`data/block_name.json`（19 类）、`data/page_labels.json`（9 类）。

换机器需先跑 DevEco「应用探索测试」下载模型，或设置 `DEVECO_*_ONNX` 环境变量指向你的路径。

## 能力单元测试（给定截图 → 返回什么）

```bash
cd onnx-deveco-probe
# 不要用系统 python3（会缺 onnxruntime），用 .venv：
python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt

python test_onnx_capabilities.py
python test_onnx_capabilities.py --image /path/to/screen.png --json

# 或在仓库根目录：
./onnx-deveco-probe/run-test.sh --image traverse-output/xhs-smart-v3/screens/s2_d1.png --json
```

## 环境

```bash
cd onnx-deveco-probe
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 用法

```bash
# 1. 只读元数据：输入/输出名、shape、类型
python probe_models.py

# 2. 用随机张量跑一轮推理，看输出 shape（验证能否加载）
python smoke_inference.py

# 3. 若你有设备截图，可试一张图（会按模型输入 resize，结果仅作形状/数值探针）
python smoke_inference.py --image /path/to/screenshot.png

# 4. 标签表（来自 appSenseToolMain，已内置 data/widget_label.json 副本）
python scan_labels.py

# 5. 单图 widget 分类（59 类中文名）
python infer_widget.py ../traverse-output/xhs-smart-v3/screens/s1_d0.png

# 6. 按 layout JSON 对每个控件区域裁图再分类
python batch_infer_layout.py ../traverse-output/xhs-smart-v3/screens/s1_d0.json \
  --image ../traverse-output/xhs-smart-v3/screens/s1_d0.png --max 15

# 7. UI 区块检测（YOLO）+ 画框（默认 DevEco jar 对齐解码）
python infer_block.py ../traverse-output/xhs-smart-v3/screens/s2_d1.png \
  --out output/s2_d1_blocks.png --json-out output/s2_d1_blocks.json --decode deveco --conf 0.4

# 8. ★ 单图分辨率/分区验证（推荐入口）
python verify_image.py ../traverse-output/xhs-smart-v3/screens/s2_d1.png --decode deveco
python verify_image.py screen.png --layout ../traverse-output/.../layouts/s2_d1.json

# 9. ★ 与 DevEco 官方 widgetBlockList 做 IOU 对比（必须用 graph/screenshot/*.jpeg）
python compare_deveco_onnx.py --task-dir "$HOME/Library/.../tasks/<uuid>" --list-scenes
python compare_deveco_onnx.py --task-dir ... --scene DD1862C5CF8F346DBB265FF3E531D962 --decode deveco
```

可视化结果默认在 `output/` 或 `output/verify/`。

**与 smart-traverse 的关系**：遍历脚本 **不** 调用 ONNX；仅在此目录做单图实验。JAR 反编译见 [DEVECO_JAR_REVERSE.md](./DEVECO_JAR_REVERSE.md)。

**完整逆向过程与盖章结论**（中文）：仓库 [wangcz_文档记录/08-DevEco探索测试逆向与结论.md](../wangcz_文档记录/08-DevEco探索测试逆向与结论.md)。

默认 **letterbox** + `decode deveco`；`--decode legacy` 为旧版（按 class 分数，易误报）。

## 标签来源

59 类控件名来自 DevEco 的 `appSenseToolMain/AppSenseTool/file/config/widget_label.json`（与 `widget_recognition.onnx` 输出维度 59 对齐）。本目录 `data/widget_label.json` 为只读副本，便于离线对照。

9 类场景名见 `data/page_labels.json`（对应 scene 模型输出 9 维）。

## 说明

- 这些脚本**不能**还原 DevEco 的完整预处理与类别表；`appSenseToolMain` 为 pyarmor 加密。
- 探测目的是弄清：模型吃多大图、几个输出、输出维度，便于判断能否在你们自己的流水线里复用。
- 模型文件体积大，**不要**提交进 git；仅提交本目录脚本。
