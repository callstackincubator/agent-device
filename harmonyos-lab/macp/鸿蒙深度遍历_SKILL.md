---
name: harmonyos-deep-traverse
description: 鸿蒙应用深度遍历。使用 agent-device CLI 对鸿蒙设备上的 App 进行自动化深度遍历，自动处理首启弹窗、权限请求、登录墙，逐屏截图并生成遍历报告。触发词：鸿蒙遍历、harmonyos traverse、深度遍历鸿蒙、遍历App鸿蒙、app遍历鸿蒙。
---

# 鸿蒙应用深度遍历

对鸿蒙设备上的指定 App 执行自动化深度遍历，收集 UI 截图和结构信息，生成遍历报告。

## 前置条件

- agent-device 已编译（`pnpm build`）
- 鸿蒙设备已连接，已开启开发者模式和 USB 调试
- 设备上已安装被测 App

## 遍历流程

```
1. 发现设备和应用
2. 预检（uitest 健康检查）
3. 清除应用数据（首次启动状态）
4. 启动应用
5. 处理首启弹窗链
6. 深度遍历主循环
7. 生成报告
```

## 步骤1：发现设备和应用

```bash
# 列出设备
agent-device devices --platform harmonyos

# 列出应用（JSON 格式）
agent-device apps --platform harmonyos --device <hdc-serial> --json
```

记录 `hdc-serial`、`bundleId`、`launchAbility`。

如果用户没有指定 App，列出第三方应用让用户选择。

## 步骤2：预检

```bash
# 确保 uitest 没有卡死（如果命令可用）
node harmonyos-lab/scripts/ensure-harmony-uitest-ready.mjs
```

如果脚本不可用，跳过此步。

## 步骤3：清除应用数据

```bash
hdc shell bm clean -n <bundleId> -d
```

确保首次启动状态，能触发隐私政策弹窗。

## 步骤4：启动应用

```bash
agent-device open <bundleId> --platform harmonyos --device <hdc-serial> --session traverse --activity <launchAbility>
agent-device wait 3000 --platform harmonyos --device <hdc-serial> --session traverse
```

## 步骤5：处理首启弹窗链

**这是遍历能否成功的关键步骤**。应用首次启动可能连续弹出多个弹窗，必须逐一处理。

### 5.1 弹窗识别规则

获取当前界面快照：

```bash
agent-device snapshot -i --platform harmonyos --device <hdc-serial> --session traverse
agent-device screenshot <输出目录>/screens/launch_<N>.png --platform harmonyos --device <hdc-serial> --session traverse
```

根据快照内容判断弹窗类型并处理：

| 弹窗类型 | 识别特征 | 处理方式 |
|----------|----------|----------|
| 隐私政策 | "隐私政策"、"个人信息保护"、"用户协议" | 点"同意"（记录弹窗存在） |
| 用户协议 | "服务协议"、"使用条款" | 点"同意并继续" |
| 通知权限 | 系统弹窗，"允许通知" | 点"允许"或"不允许" |
| 位置权限 | "获取位置信息" | 点"不允许"（避免干扰） |
| 广告弹窗 | "跳过"、"关闭"、"×"、倒计时 | 点关闭按钮 |
| **底部运营弹层** | `[rootwebarea]` + App 自身功能推荐（"特价"、"免税"等），back 会退出应用 | **scroll down 向下滑走**（实测航旅纵横有效）；不要用 back |
| 引导向导 | "下一步"、"我知道了"、"开始使用" | 逐页跳过或点跳过 |
| 华为账号 | "登录华为账号" | 点"取消"或"跳过" |
| 更新提示 | "发现新版本"、"立即更新" | 点"以后再说"或"取消" |

### 5.2 弹窗处理循环

```
循环（最多 15 次）：
  1. snapshot -i
  2. 截图保存
  3. 分析弹窗类型
  4. 按规则处理弹窗（点同意/关闭/跳过）
  5. wait 1500
  6. 检查是否进入应用主界面（底部有导航栏 或 主内容区）
  7. 如进入主界面 → 退出循环
  8. 如无弹窗且不在主界面 → 可能是系统弹窗，用全树快照检查
```

### 5.3 系统弹窗特殊处理

如果 `-i` 快照元素很少（< 5 个），可能是系统弹窗不在投影内：

```bash
agent-device snapshot --platform harmonyos --device <hdc-serial> --session traverse
```

在全树中找"允许"、"确定"等按钮并点击。

### 5.4 无法处理的弹窗

如果遇到无法识别的弹窗：
- 截图保存
- 跳过该应用，在报告中记录"首启弹窗无法处理"

## 步骤6：深度遍历主循环

### 6.1 数据结构

维护以下状态：
- `visitedScreens`: Set of fingerprint（节点数 + 标签列表）
- `screenCounter`: 屏幕计数器
- `currentDepth`: 当前深度
- `maxDepth`: 最大深度（默认 5）
- `clickHistory`: 点击历史栈（用于返回）

### 6.2 单屏遍历流程

```
1. 截图 + 快照
   agent-device screenshot <dir>/screens/s<N>_d<D>.png
   agent-device snapshot -i

2. 计算 fingerprint，检查是否已访问
   fingerprint = 节点数 + 可见标签排序拼接
   如已访问 → back + return

3. 记录当前屏幕信息

4. 提取可点击目标
   从 snapshot -i 输出中提取所有 hittable 的 @ref 元素

5. 按优先级排序点击计划
   优先级（从高到低）：
   a. 底部 Tab 导航（"首页"、"发现"、"我的" 等）
   b. 顶部导航栏按钮
   c. 列表项 / 卡片
   d. 功能按钮
   e. 其他可点击元素

6. 过滤不安全目标
   不点击：
   - "不同意"、"拒绝"、"取消"、"关闭应用"
   - "退出"、"注销"、"删除账号"
   - 坐标在屏幕边缘的极小元素（可能是误触）
   - 包含"登录"的目标（除非用户要求登录）

7. 逐个点击并检测
   对每个目标：
   a. 记录点击前 fingerprint
   b. agent-device press @ref 或 'label="xxx"'
   c. wait 2500
   d. snapshot -i
   e. 计算新 fingerprint
   f. 判断是否进入新界面：
      - 节点数变化 > 15%
      - 或标签列表变化
      - 且未访问过
   g. 如果是新界面：
      - 如 depth < maxDepth → 递归遍历新界面
      - 遍历完成后 back 返回
   h. 如果不是新界面 → 继续下一个目标
```

### 6.3 遍历中的特殊情况处理

#### 登录墙检测

如果快照中出现以下特征，判定为登录墙：
- "请先登录"、"登录后查看"
- 手机号输入框 + 验证码按钮
- 第三方登录按钮（微信、QQ、支付宝）

**处理**：跳过该目标，back 返回，记录"遇到登录墙"。

#### Web / H5 页面检测

如果快照出现 `[web]` 节点：
- 截图记录
- 尝试找到返回按钮或 back 返回
- 不在 H5 页面内递归遍历（不可控）

#### 应用崩溃 / 退出

如果连续 2 次 snapshot 返回错误或节点数为 0：
- 尝试重新 open 应用
- 如失败，终止遍历，记录"应用崩溃"

#### 弹窗出现在遍历过程中

如果快照中检测到弹窗特征（元素少 + 有"同意"/"确定"按钮）：
- 按首启弹窗规则处理
- 处理完继续遍历

#### 滚动探索

如果当前屏幕所有目标都已点击且没有新界面：
- scroll down 1-2 次
- 重新 snapshot -i
- 如发现新目标，继续遍历
- 如无新目标，该屏幕遍历完成

### 6.4 遍历终止条件

满足以下任一条件则停止：
- 所有可达屏幕都已遍历（无新 fingerprint）
- 达到最大深度（maxDepth）
- 达到最大屏幕数（默认 50）
- 应用崩溃无法恢复
- 运行时间超过上限（默认 30 分钟）

## 步骤7：生成报告

### 7.1 输出目录结构

```
harmonyos-lab/reports/traverse-<bundleId>-<日期>/
├── screens/                    # 截图
│   ├── launch_1.png           # 首启弹窗
│   ├── s1_d0.png              # 第1屏 depth=0
│   ├── s2_d1.png              # 第2屏 depth=1
│   └── ...
├── traverse-report.md          # 遍历报告
└── traverse-report.json        # 结构化数据
```

### 7.2 报告内容

```markdown
# <AppName> 遍历报告

## 基本信息
- Bundle ID:
- 版本:
- 设备:
- 遍历时间:
- 总屏幕数:
- 总点击数:

## 遍历结果
| 屏幕ID | 深度 | 父动作 | 截图 | 发现的交互 |
|--------|------|--------|------|-----------|

## 首启弹窗链
1. 隐私政策弹窗 → 点"同意"
2. 通知权限 → 点"不允许"
3. 广告弹窗 → 点"跳过"

## 未覆盖区域
- 登录墙：xxx 页面（需要登录）
- H5 页面：xxx 页面
- 崩溃：xxx 操作导致崩溃

## 遍历覆盖率
- 可达屏幕数 / 总屏幕数
- 未登录可达 / 需登录才能到达
```

## 关键规则

1. **每次操作前先截图**：所有操作都有视觉证据
2. **用 selector 点击优先**：`press 'label="xxx"'` 比 `press @ref` 更稳定
3. **弹窗处理不遗漏**：隐私、权限、广告、引导都要处理
4. **遇到登录墙不强行突破**：记录后跳过
5. **fingerprint 去重避免死循环**：相同界面不重复遍历
6. **遍历中随时可中断**：即使中断，已有截图和记录仍有价值
7. **不点击危险操作**：不同意、退出、删除、注销等
8. **超时保护**：单屏遍历不超过 3 分钟，总遍历不超过 30 分钟
9. **所有输出文件统一存放**：截图、报告放在指定目录
10. **不要编写脚本代码**：所有操作通过 agent-device CLI 命令完成
11. **优先使用 CLI 而非 HDC 原始命令**：除 bm clean 外，都用 agent-device

## agent-device 命令速查

```bash
# 设备和应用
agent-device devices --platform harmonyos
agent-device apps --platform harmonyos --device <serial> --json
agent-device open <bundleId> --platform harmonyos --device <serial> --session traverse
agent-device close --platform harmonyos --device <serial> --session traverse

# UI 交互
agent-device snapshot -i --platform harmonyos --device <serial> --session traverse
agent-device snapshot --platform harmonyos --device <serial> --session traverse
agent-device screenshot <path> --platform harmonyos --device <serial> --session traverse
agent-device press 'label="同意"' --platform harmonyos --device <serial> --session traverse
agent-device press @e5 --platform harmonyos --device <serial> --session traverse
agent-device scroll down --platform harmonyos --device <serial> --session traverse
agent-device back --platform harmonyos --device <serial> --session traverse
agent-device wait 2000 --platform harmonyos --device <serial> --session traverse
agent-device home --platform harmonyos --device <serial> --session traverse

# 清除数据（HDC 原始命令）
hdc shell bm clean -n <bundleId> -d
```

## 环境变量

遍历时用户可能需要指定：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| 设备序列号 | 从 devices 命令获取 | `--device` 参数 |
| 最大深度 | 5 | 递归遍历深度 |
| 最大屏幕数 | 50 | 遍历屏幕上限 |
| 超时 | 30 分钟 | 总运行时间上限 |
| 是否清数据 | 是 | 首次启动检测需要 |
