---
name: 191-scenario-1-privacy-policy-search-harmonyos
description: 191号文合规检测-场景一：搜索/查找隐私政策（鸿蒙版）。检测鸿蒙App是否存在隐私政策、是否可访问、是否可阅读、是否包含收集使用规则。使用agent-device操作鸿蒙设备，通过UI截图和交互方式逐屏查找隐私政策入口。触发词：搜索隐私政策鸿蒙、查找隐私政策鸿蒙、隐私政策检测鸿蒙、场景一鸿蒙、191号文场景一鸿蒙、privacy policy search harmonyos、隐私政策合规检测鸿蒙、检测隐私政策鸿蒙、隐私政策是否存在鸿蒙。
---

# 191号文合规检测 - 场景一：搜索/查找隐私政策（鸿蒙版）

检测鸿蒙App是否存在隐私政策、隐私政策是否可访问、是否可阅读、是否包含收集使用规则。对应191号文一-1（含S1、S2两个场景）、一-2、一-3、一-4的检测要求。

## 检测流程总览

```
1. 列出设备，获取 hdc-serial
2. 列出已安装应用，确认被测App bundle名称和 launchAbility
3. 清除应用数据（确保首次启动状态）
4. 启动应用并创建会话
5. 处理首次启动弹窗（隐私政策弹窗、广告、引导向导、权限提醒）
6. 检查首次启动时是否弹出隐私政策
7. 如未弹出，进入"我的"页面查找隐私政策入口
8. 尝试打开隐私政策文本，检查可访问性
9. 检查隐私政策文本的可阅读性和收集规则内容
10. 汇总检测结果
```

## 前置条件

- 已安装被测App（hap包）
- 已连接鸿蒙设备
- 已安装agent-device工具并编译完成（`pnpm build`）
- 鸿蒙设备已开启开发者模式和USB调试

## 步骤1：列出设备获取 hdc-serial

```bash
# 列出鸿蒙设备
agent-device devices --platform harmonyos

# 输出示例：
# FMR0223N13000649  Huawei Mate 60 Pro
```

记录设备序列号（如 `FMR0223N13000649`），后续命令必须带 `--device <hdc-serial>`。

## 步骤2：列出应用确认 Bundle 名称和 launchAbility

```bash
# 列出应用（JSON格式便于解析）
agent-device apps --platform harmonyos --device <hdc-serial> --json

# 筛选目标应用
agent-device apps --platform harmonyos --device <hdc-serial> --json | jq '.data.apps[] | select(.bundleId | contains("xhs"))'

# 输出示例：
# {
#   "bundleId": "com.xingin.xhs_hos",
#   "appName": "小红书",
#   "launchAbility": "EntryAbility"
# }
```

记录：
- `bundleId`：应用包名（如 `com.xingin.xhs_hos`）
- `launchAbility`：启动入口（如 `EntryAbility`）

## 步骤3：清除应用数据（确保首次启动状态）

**关键步骤**：191号文检测首次启动隐私政策弹窗，必须先清除应用数据。

```bash
# 方法1：清除用户数据（推荐）
hdc shell bm clean -n com.xingin.xhs_hos -d

# 方法2：清除缓存数据
hdc shell bm clean -n com.xingin.xhs_hos -c

# 方法3：同时清除数据和缓存
hdc shell bm clean -n com.xingin.xhs_hos -d -c

# 验证清除结果
hdc shell bm dump -n com.xingin.xhs_hos | grep -i "data"
```

**注意**：
- `-d` 清除用户数据（隐私弹窗会重新出现）
- `-c` 清除缓存数据
- 清除后应用回到首次安装状态

## 步骤4：启动应用并创建会话

```bash
# 创建会话名（建议用 bundle 名）
SESSION_NAME="xhs_191_s1"

# 启动应用（自动使用 wukong appinfo 解析 launchAbility）
agent-device open com.xingin.xhs_hos --platform harmonyos --device <hdc-serial> --session $SESSION_NAME

# 如果自动解析失败，手动指定 launchAbility
agent-device open com.xingin.xhs_hos --platform harmonyos --device <hdc-serial> --session $SESSION_NAME --activity EntryAbility

# 强制重新启动（终止现有进程）
agent-device open com.xingin.xhs_hos --platform harmonyos --device <hdc-serial> --session $SESSION_NAME --relaunch
```

**注意**：
- `--device <hdc-serial>` 必须指定
- `--session <name>` 建议指定，便于后续命令复用
- open 会自动检测屏幕锁定并尝试解锁
- open 会自动关闭部分系统弹窗

## 步骤5：处理首次启动弹窗

应用首次启动时可能弹出多种干扰弹窗，需要按优先级逐一处理。

### 5.1 截图检查当前页面状态

```bash
# 获取交互式快照（包含元素 @ref）
agent-device snapshot -i --platform harmonyos --device <hdc-serial> --session $SESSION_NAME

# 保存截图到指定目录
mkdir -p ./191-scenario-1/screenshots
agent-device screenshot ./191-scenario-1/screenshots/step5_1.png --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
```

**snapshot -i 输出格式**：
```
@e1 [button] label="同意并继续" enabled hittable
@e2 [text] label="隐私政策"
@e3 [button] label="不同意"
```

### 5.2 隐私政策弹窗（最高优先级）

检查快照输出中是否包含"隐私政策"、"隐私"、"Privacy"等关键词。

如果发现隐私政策弹窗：
- **记录：首次启动时弹出了隐私政策阅读提醒**
- **截图保存证据**
- **尝试点击隐私政策链接**

**点击隐私政策链接**：
```bash
# 使用 selector 点击（推荐）
agent-device press 'label="隐私政策"' --platform harmonyos --device <hdc-serial> --session $SESSION_NAME

# 或使用 @ref 点击
agent-device press @e2 --platform harmonyos --device <hdc-serial> --session $SESSION_NAME

# 点击后等待并重新截图
agent-device wait 2000 --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
agent-device snapshot -i --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
```

**如果弹窗同时有"同意"选项**：
- 先不点击同意，先截图记录并尝试点击隐私政策链接
- 如果需要点击同意才能继续，记录此情况后点击同意
- 点击同意后重新截图

```bash
# 点击同意按钮
agent-device press 'label="同意并继续"' --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
```

### 5.3 广告弹窗

检查快照中是否有"跳过"、"关闭"、"×"等关闭按钮：

```bash
# 点击关闭按钮
agent-device press 'label="跳过"' --platform harmonyos --device <hdc-serial> --session $SESSION_NAME

# 或点击 @ref
agent-device press @e5 --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
```

### 5.4 引导向导

检查是否有"我知道了"、"跳过"、"下一步"等按钮：

```bash
# 逐页跳过引导
agent-device press 'label="跳过"' --platform harmonyos --device <hdc-serial> --session $SESSION_NAME

# 可能需要多次操作
agent-device wait 1000 --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
agent-device snapshot -i --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
agent-device press 'label="下一步"' --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
```

### 5.5 系统权限弹窗

系统权限弹窗处理：

```bash
# 点击"允许"
agent-device press 'label="允许"' --platform harmonyos --device <hdc-serial> --session $SESSION_NAME

# 点击"不允许"（如果测试拒绝权限场景）
agent-device press 'label="不允许"' --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
```

**注意**：系统通知权限弹窗可能不在 `-i` 投影内，需要用全树快照：

```bash
# 获取完整 UI 树
agent-device snapshot --platform harmonyos --device <hdc-serial> --session $SESSION_NAME

# 在全树中找"允许"
agent-device find "允许" press --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
```

### 5.6 弹窗处理循环

重复操作直到进入应用主界面：

```
循环（最多10次）：
  1. snapshot -i
  2. 检查是否进入主界面（有底部导航栏或主要内容）
  3. 如有隐私弹窗 → 截图记录 → 点击隐私政策链接
  4. 如有广告/引导 → 点击关闭/跳过
  5. 如有权限弹窗 → 点击允许/不允许
  6. 如进入主界面 → 退出循环
```

## 步骤6：记录首次启动隐私政策弹窗情况

根据步骤5的结果记录：

| 情况 | 记录内容 |
|------|----------|
| 首次启动弹出隐私政策弹窗 | 弹窗形式、隐私政策链接位置、是否需要同意才能继续 |
| 首次启动未弹出隐私政策弹窗 | 标记"未弹出"，需要在应用内查找 |

## 步骤7：在应用内查找隐私政策入口

**无论首次启动是否弹出隐私政策，都需要在应用内查找隐私政策入口**。

### 7.1 导航到"我的"页面

```bash
# 截图确认当前页面
agent-device snapshot -i --platform harmonyos --device <hdc-serial> --session $SESSION_NAME

# 找到底部导航栏的"我的"、"个人中心"入口
agent-device press 'label="我的"' --platform harmonyos --device <hdc-serial> --session $SESSION_NAME

# 等待页面加载
agent-device wait 2000 --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
agent-device snapshot -i --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
```

### 7.2 进入设置查找隐私政策

```bash
# 在"我的"页面查找"设置"按钮
agent-device press 'label="设置"' --platform harmonyos --device <hdc-serial> --session $SESSION_NAME

# 等待设置页面加载
agent-device wait 1000 --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
agent-device snapshot -i --platform harmonyos --device <hdc-serial> --session $SESSION_NAME

# 查找"隐私政策"、"隐私"、"关于"、"法律信息"等入口
agent-device press 'label="隐私政策"' --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
```

### 7.3 如果页面需要滚动

```bash
# 向下滚动查看更多内容
agent-device scroll down --platform harmonyos --device <hdc-serial> --session $SESSION_NAME

# 或向上滚动
agent-device scroll up --platform harmonyos --device <hdc-serial> --session $SESSION_NAME

# 滚动后重新截图
agent-device snapshot -i --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
```

**注意**：`scroll down` = 内容向下滚动（手指向上划），`scroll up` = 内容向上滚动（手指向下划）。

### 7.4 常见隐私政策入口位置

1. **"我的" → "设置" → "隐私政策"**
2. **"我的" → "设置" → "关于" → "隐私政策"**
3. **首页菜单按钮 → "设置" → "隐私政策"**

### 7.5 记录查找路径

- 记录从主页面到隐私政策的每一步操作
- 记录点击次数（合规判定需要）

## 步骤8：检查隐私政策文本的可访问性

找到隐私政策入口后，点击进入。

### 8.1 点击操作

```bash
# 使用 selector 点击
agent-device press 'label="隐私政策"' --platform harmonyos --device <hdc-serial> --session $SESSION_NAME

# 等待页面加载
agent-device wait 2000 --platform harmonyos --device <hdc-serial> --session $SESSION_NAME

# 截图检查结果
agent-device screenshot ./191-scenario-1/screenshots/privacy_policy_page.png --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
agent-device snapshot -i --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
```

### 8.2 可访问性检查项

| 检查项 | 合规标准 | 不合规情况 |
|--------|----------|------------|
| 链接能否打开 | 正常打开，非空链接 | 空白页、报错页面、加载失败 |
| 打开内容是否正确 | 是隐私政策内容 | 其他内容、广告页、无关页面 |

**如果出现空白页或报错**：
- 截图保存证据
- 记录为"不合规"
- 尝试返回继续查找其他入口

```bash
# 返回上一页
agent-device back --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
```

## 步骤9：检查隐私政策文本的可阅读性和收集规则内容

### 9.1 可阅读性检查

打开隐私政策后截图检查：

```bash
agent-device screenshot ./191-scenario-1/screenshots/privacy_text_1.png --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
```

| 检查项 | 合规标准 |
|--------|----------|
| 文字字号 | 不过小，可正常阅读 |
| 文字颜色 | 不过淡，清晰可见 |
| 语言版本 | 提供简体中文版 |
| 排版格式 | 无严重排版问题 |

### 9.2 访问路径点击次数检查

从应用主页面开始统计：

| 步骤 | 点击次数 | 说明 |
|------|----------|------|
| 主页面 | 0 | 起点 |
| 进入"我的" | 1 | 第一次点击 |
| 进入"设置" | 2 | 第二次点击 |
| 找到"隐私政策" | 3 | 第三次点击 |
| 点击打开 | 4 | 第四次点击（此时合规） |

**合规标准**：不超过4次点击即可访问隐私政策全文。

### 9.3 收集规则内容检查

滚动查看隐私政策内容：

```bash
# 滚动2-3屏查看核心内容
agent-device scroll down --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
agent-device screenshot ./191-scenario-1/screenshots/privacy_text_2.png --platform harmonyos --device <hdc-serial> --session $SESSION_NAME

agent-device scroll down --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
agent-device screenshot ./191-scenario-1/screenshots/privacy_text_3.png --platform harmonyos --device <hdc-serial> --session $SESSION_NAME

agent-device scroll down --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
agent-device screenshot ./191-scenario-1/screenshots/privacy_text_4.png --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
```

**必须包含的7大核心内容（至少5项合规）**：

| 核心内容 | 检查关键词 |
|----------|------------|
| ✅ 信息收集 | "收集"、"获取"、"采集" |
| ✅ 信息使用 | "使用"、"用途"、"目的" |
| ✅ 信息共享 | "共享"、"披露"、"第三方" |
| ✅ 信息保护 | "保护"、"安全"、"加密" |
| ✅ 用户权利 | "权利"、"删除"、"撤回" |
| ✅ 政策更新 | "更新"、"变更"、"修订" |
| ✅ 投诉渠道 | "投诉"、"联系方式"、"反馈" |

### 9.4 使用 find 查找关键词

```bash
# 查找"收集"关键词
agent-device find "收集" --platform harmonyos --device <hdc-serial> --session $SESSION_NAME

# 查找"共享"关键词
agent-device find "共享" --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
```

**注意**：`find` 命令只查找，不执行操作。如果需要查找后操作，加 action：

```bash
# 查找并点击
agent-device find "隐私政策" press --platform harmonyos --device <hdc-serial> --session $SESSION_NAME
```

## 步骤10：汇总检测结果

### 输出目录结构

```
./191-scenario-1/
├── screenshots/                    # 所有截图文件
│   ├── step5_1.png                 # 首次启动截图
│   ├── step5_2.png                 # 弹窗处理截图
│   ├── privacy_policy_page.png     # 隐私政策页面截图
│   ├── privacy_text_1.png          # 隐私政策内容截图
│   ├── privacy_text_2.png          # 隐私政策内容截图（滚动后）
│   └── ...
├── com.xingin.xhs_hos_brief_report.md      # 简报
└── com.xingin.xhs_hos_detailed_report.md   # 详细报告
```

### 创建目录

```bash
mkdir -p ./191-scenario-1/screenshots
```

### 报告命名规范

使用 bundleId 作为前缀：
- 简报：`com.xingin.xhs_hos_brief_report.md`
- 详细报告：`com.xingin.xhs_hos_detailed_report.md`

## agent-device 鸿蒙端常用命令速查

### 设备和应用管理

```bash
# 列出设备（获取 hdc-serial）
agent-device devices --platform harmonyos

# 列出应用（含 launchAbility）
agent-device apps --platform harmonyos --device <hdc-serial> --json

# 启动应用
agent-device open <bundleId> --platform harmonyos --device <hdc-serial> --session <name>

# 强制重新启动
agent-device open <bundleId> --platform harmonyos --device <hdc-serial> --session <name> --relaunch

# 关闭应用
agent-device close <bundleId> --platform harmonyos --device <hdc-serial> --session <name>

# 查看前台应用
agent-device appstate --platform harmonyos --device <hdc-serial> --session <name>
```

### 清除应用数据（使用 HDC）

```bash
# 清除用户数据（首次启动检测必须）
hdc shell bm clean -n <bundleId> -d

# 清除缓存数据
hdc shell bm clean -n <bundleId> -c

# 同时清除数据和缓存
hdc shell bm clean -n <bundleId> -d -c
```

### UI 交互

```bash
# 获取交互式快照（含 @ref）
agent-device snapshot -i --platform harmonyos --device <hdc-serial> --session <name>

# 截图
agent-device screenshot <path> --platform harmonyos --device <hdc-serial> --session <name>

# 点击（使用 selector 或 @ref）
agent-device press 'label="同意"' --platform harmonyos --device <hdc-serial> --session <name>
agent-device press @e1 --platform harmonyos --device <hdc-serial> --session <name>

# 点击（使用坐标）
agent-device press 400 1380 --platform harmonyos --device <hdc-serial> --session <name>

# 长按
agent-device longpress 'label="设置"' --platform harmonyos --device <hdc-serial> --session <name>
agent-device longpress @e5 --platform harmonyos --device <hdc-serial> --session <name>

# 滚动（四个方向）
agent-device scroll down --platform harmonyos --device <hdc-serial> --session <name>
agent-device scroll up --platform harmonyos --device <hdc-serial> --session <name>
agent-device scroll left --platform harmonyos --device <hdc-serial> --session <name>
agent-device scroll right --platform harmonyos --device <hdc-serial> --session <name>

# 输入文本
agent-device type "测试文本" --platform harmonyos --device <hdc-serial> --session <name>

# 点击后输入
agent-device fill 'label="搜索"' "关键词" --platform harmonyos --device <hdc-serial> --session <name>

# 返回
agent-device back --platform harmonyos --device <hdc-serial> --session <name>

# 返回主界面
agent-device home --platform harmonyos --device <hdc-serial> --session <name>

# 等待
agent-device wait 2000 --platform harmonyos --device <hdc-serial> --session <name>
```

### 查找和验证

```bash
# 查找元素（只查找）
agent-device find "隐私政策" --platform harmonyos --device <hdc-serial> --session <name>

# 查找并操作
agent-device find "隐私政策" press --platform harmonyos --device <hdc-serial> --session <name>

# 判断是否可见
agent-device is visible 'label="隐私政策"' --platform harmonyos --device <hdc-serial> --session <name>

# 获取文本内容
agent-device get text @e1 --platform harmonyos --device <hdc-serial> --session <name>

# 等待元素出现
agent-device wait 'label="隐私政策"' 5000 --platform harmonyos --device <hdc-serial> --session <name>
```

### 会话管理

```bash
# 列出活跃会话
agent-device session list --platform harmonyos --device <hdc-serial>

# 关闭会话
agent-device close --platform harmonyos --device <hdc-serial> --session <name>
```

### 鸿蒙特有命令

```bash
# 生成 UI 认知地图（自动关闭系统弹窗）
agent-device cognition --platform harmonyos --device <hdc-serial> --session <name> --json

# 查看键盘状态
agent-device keyboard status --platform harmonyos --device <hdc-serial> --session <name> --json

# 关闭键盘
agent-device keyboard dismiss --platform harmonyos --device <hdc-serial> --session <name>
```

## 关键规则

1. **首次启动检测必须先清数据**：`hdc shell bm clean -n <bundleId> -d`
2. **必须带 --device <hdc-serial> 参数**：鸿蒙设备序列号
3. **建议带 --session <name> 参数**：便于后续命令复用会话
4. **使用 snapshot -i 获取 @ref**：交互元素才有 @ref，便于点击
5. **使用 selector 点击**：`press 'label="同意"'` 比 `press @e1` 更稳定
6. **每次操作前先截图**：基于快照内容决定下一步
7. **处理弹窗时不遗漏**：隐私弹窗、广告、引导、权限都要处理
8. **记录完整路径**：从主页面到隐私政策的每步操作和点击次数
9. **遇到无法处理时截图保存证据**，如实报告
10. **所有输出文件统一存放**：截图、报告放在 skill 目录
11. **报告文件名使用 bundleId 前缀**
12. **不要编写脚本或代码**：所有操作通过 agent-device CLI 或 HDC 命令完成