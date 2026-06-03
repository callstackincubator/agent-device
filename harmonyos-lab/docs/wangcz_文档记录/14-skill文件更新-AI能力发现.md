# skill文件更新 — AI能力发现

| 项 | 内容 |
|----|------|
| 日期 | 2026-05-28 |
| 动机 | AI agent 使用原始 HDC 命令而非 agent-device CLI |
| 生效方式 | 无需 build，skill 文件即时生效 |

---

## 1. 问题诊断

### 1.1 原始 skill description 缺失 HarmonyOS

```yaml
# skills/agent-device/SKILL.md (改前)
description: Automates Apple-platform apps (iOS, tvOS, macOS) and Android devices.
```

**问题**：
1. description 完全未提及 HarmonyOS → AI 认为 HarmonyOS 不支持 CLI
2. 无明确指示禁止使用原始 HDC 命令
3. 新实现的 `scroll`/`rotate`/`keyboard`/`doubleTap` 未在 skill 中列出

### 1.2 现象

用户反馈：AI agent 处理 HarmonyOS 任务时直接使用 `hdc shell uitest ...` 等原始命令，绕过了 agent-device CLI 的安全性和可观测性。

---

## 2. 修复方案

### 2.1 更新 description

```yaml
# 改后
description: Automates Apple-platform apps (iOS, tvOS, macOS), Android devices, and HarmonyOS devices. Use when navigating apps, taking snapshots/screenshots, tapping, typing, scrolling, rotating, keyboard interactions, extracting UI info, collecting logs/network/perf evidence, or planning agent-device CLI commands. For HarmonyOS, ALWAYS use agent-device CLI instead of raw HDC commands.
```

**改动**：
- 明确加入 HarmonyOS
- 加入 `rotating`, `keyboard interactions` 等新能力关键词
- 结尾强调 HarmonyOS 必须使用 CLI

### 2.2 添加禁止原始命令指示

```markdown
**IMPORTANT**: Always use `agent-device` CLI commands for device automation. Do NOT use raw platform commands like:
- `hdc shell ...` for HarmonyOS
- `adb shell ...` for Android
- `xcrun simctl ...` for iOS Simulator

The agent-device CLI provides unified, well-documented interfaces across all platforms. Raw commands bypass the safety and observability features built into agent-device.
```

### 2.3 添加命令能力表

在 HarmonyOS Best Practices 下新增：

| Command | Description | HarmonyOS Notes |
|---------|-------------|-----------------|
| `scroll up/down/left/right` | Scroll content | Fixed direction semantics |
| `rotate portrait/landscape-left` | Rotate screen | May need system permissions |
| `keyboard status` | Check keyboard visibility | Returns `{ visible, height }` |
| `keyboard dismiss` | Close soft keyboard | Uses Back key |
| `press --double-tap` | Double tap gesture | Native uitest doubleClick |

### 2.5 更新 CLI help 输出

```typescript
// src/utils/command-schema.ts

// 改前
const header = `agent-device <command> [args] [--json]

CLI to control iOS and Android devices for AI agents.
`;

// 改后
const header = `agent-device <command> [args] [--json]

CLI to control iOS, Android, and HarmonyOS devices for AI agents.
`;
```

**EXAMPLE_LINES 添加鸿蒙示例**：

```typescript
const EXAMPLE_LINES = [
  'agent-device open Settings --platform ios',
  'agent-device open TextEdit --platform macos',
  // ...
  'agent-device test ./suite --platform android',
  'agent-device open com.example.app --platform harmonyos --device <hdc-serial>',  // 新增
] as const;
```

**效果**：`agent-device help` 输出现在显示 HarmonyOS 支持，AI 能看到鸿蒙示例。

---

## 3. 变更文件清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `skills/agent-device/SKILL.md` | 修改 | description 补 HarmonyOS + 禁 HDC 原生 + 鸿蒙命令表 |
| `src/utils/command-schema.ts` | 修改 | CLI description 补 HarmonyOS + Examples 添加鸿蒙示例 |

---

## 4. 验证

skill 文件无需 build，AI agent 加载时直接生效。

验证方式：
1. 在新的 agent 会话中问 "HarmonyOS 支持哪些命令"
2. 检查 AI 是否引用 SKILL.md 中的能力表
3. 确认 AI 不再推荐 `hdc shell` 原始命令

---

## 5. skill 文件作用机制

| 层级 | 文件 | 作用 |
|------|------|------|
| 注册 | `skills/agent-device/SKILL.md` | AI agent 发现入口（description 匹配触发） |
| 详情 | SKILL.md 内容 | 命令用法、平台限制、示例 workflow |
| 运行时 | `agent-device help workflow` | 版本匹配的实时 CLI 指导 |

**关键路径**：
1. 用户请求设备自动化 → AI 检查可用 skills
2. description 匹配 → AI 加载 SKILL.md
3. SKILL.md 内容指导 → AI 执行 `agent-device help workflow`
4. help workflow 输出 → AI 规划具体命令

---

## 6. 与其他文档交叉引用

- 基础命令修复：[13-鸿蒙基础命令修复与能力补全](./13-鸿蒙基础命令修复与能力补全.md)
- 平台路由等基础：[09-鸿蒙平台能力补全-路由与启动](./09-鸿蒙平台能力补全-路由与启动.md)
- CLI 基础用法：[01-CLI与仓库用法](./01-CLI与仓库用法.md)

---

## 7. 回滚

```bash
git checkout -- skills/agent-device/SKILL.md
```