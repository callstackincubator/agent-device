---
name: agent-device
description: Automates Apple-platform apps (iOS, tvOS, macOS), Android devices, and HarmonyOS devices. Use when navigating apps, taking snapshots/screenshots, tapping, typing, scrolling, rotating, keyboard interactions, extracting UI info, collecting logs/network/perf evidence, or planning agent-device CLI commands. For HarmonyOS, ALWAYS use agent-device CLI instead of raw HDC commands.
---

# agent-device

Router only. Private setup before using this skill:

**IMPORTANT**: For HarmonyOS, always use `agent-device` CLI commands. Do NOT use raw `hdc shell uitest ...` commands. The CLI provides unified, safe interfaces; raw commands bypass safety and observability features.

```bash
agent-device --version
```

If that fails but the user may have installed `agent-device` globally, check the user's configured login/interactive shell and environment before using `npx`. Resolve the command the same way the user would from a normal terminal session, then run the absolute binary path if found. This may require inspecting shell startup behavior or package-manager/global bin locations; do not assume the Codex process `PATH` is the user's `PATH`.

Require `agent-device >= 0.14.0`; older CLIs lack these help topics. If older, stop and tell the user to upgrade the trusted install or approve an exact-version npm command. Do not run `npm install -g agent-device@latest` or `npx -y agent-device@latest` autonomously, and do not include version/upgrade commands in final plans.

Before your first agent-device command or plan, read the version-matched CLI guide:

```bash
agent-device help workflow
```

Escalate only when relevant:

```bash
agent-device help debugging
agent-device help react-native
agent-device help react-devtools
agent-device help remote
agent-device help macos
agent-device help dogfood
```

Default loop: `open -> snapshot/-i -> get/is/find or press/fill/scroll/wait -> verify -> close`.

## Cognition Map

Before blind testing, use `cognition` to generate a UI structure overview for AI planning:

```bash
agent-device cognition [--platform ios|macos|android|linux|apple|harmonyos] [--session <name>] [--json]
```

The cognition command analyzes the current UI and returns:

- **Overview**: platform, screen resolution, total nodes, tree depth, complexity (simple/medium/complex)
- **Structure**: layout patterns, main container count
- **Interactions**: clickable elements, buttons, input fields, tabs
- **Features**: scroll regions, tabs, modals, lists, forms
- **Suggestions**: testing recommendations based on UI complexity
- **Test Priority**: high/medium/low scoring based on complexity and interactions

Example usage:

```bash
agent-device open com.example.app --platform android
agent-device cognition --json
```

The `llmReport` field contains a formatted summary for AI planning:

```
# UI认知地图

## 概览
- 平台: android
- 屏幕分辨率: 1080x2400
- UI节点总数: 156
- 树深度: 12层
- 界面复杂度: medium

## 测试优先级
- **中等优先级**

## 测试建议
- 存在Tab导航，建议逐个Tab遍历
- 存在滚动区域，建议测试滚动交互
```

Use this before exploratory testing to understand app structure and avoid blind navigation.

Use this skill only to route into version-matched CLI help. Let `help workflow` provide exact command shapes, platform limits, and current workflow guidance.

For precise location workflows, read the installed `settings` help before planning so coordinate support and platform limits come from the active CLI version.

## HarmonyOS Best Practices

When working with HarmonyOS devices, follow these guidelines:

### App Launch

- **launchAbility discovery**: `agent-device apps --platform harmonyos --device <hdc-serial> --json` returns structured rows with `launchAbility` (from device `wukong appinfo`, cached 5 minutes).
- **Automatic open**: `open` uses wukong appinfo when `--activity` is omitted, then falls back through MainAbility, EntryAbility, and bundle-only start.
- **Explicit override**: pass `--activity <launchAbility>` when auto-resolution is insufficient.
- **Screen lock detection**: The CLI automatically checks and attempts to unlock the screen before launching apps
- **System dialog handling**: Common system dialogs are automatically dismissed after app launch

### System Dialogs

The CLI automatically detects and handles these HarmonyOS system dialogs:

- "暂无可用打开方式" (No available opening method)
- Notification permission dialogs
- Privacy policy dialogs
- Update prompts
- Common button patterns: "确定", "知道了", "同意并继续", "允许", "不允许"

### Cognition Map

The `cognition` command on HarmonyOS:

- Auto-dismisses system dialogs before generating the UI map
- Detects unlabeled icon buttons (like settings gear icons)
- Provides HarmonyOS-specific testing suggestions

### Known Issues and Workarounds

1. **App package names**: Some system apps have different package names than expected (e.g., `com.huawei.hmos.settings` not `com.huawei.hmosSettings`)
2. **Ability names vary**: third-party apps may use `EntryAbility`, `DcarAbility`, etc.—read `launchAbility` from `apps --json` instead of guessing
3. **Screen unlock**: Automatic screen unlock may not work on all devices; manual intervention may be required

### HarmonyOS Commands

| Command | Description | Notes |
|---------|-------------|-------|
| `scroll up/down/left/right` | Scroll content | 方向已修复：scroll up = 内容上滚 |
| `rotate portrait/landscape-left` | Rotate screen | 可能需要系统权限 |
| `keyboard status` | Check keyboard visibility | 返回 `{ visible, height }` |
| `keyboard dismiss` | Close soft keyboard | 使用 Back 键关闭 |
| `press --double-tap` | Double tap gesture | 原生 uitest doubleClick |
| `back` | Navigate back | 返回键导航 |
| `home` | Go to home screen | 回到桌面 |

### Example Workflow

```bash
# List apps with launchAbility (HarmonyOS)
agent-device apps --platform harmonyos --device <hdc-serial> --json

# Open without guessing ability (uses wukong appinfo)
agent-device open com.example.app --platform harmonyos --device <hdc-serial>

# Generate cognition map (auto-dismisses dialogs)
agent-device cognition --platform harmonyos --json

# Check app state
agent-device appstate --platform harmonyos --device <hdc-serial>
```
