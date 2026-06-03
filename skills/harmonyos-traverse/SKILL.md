---
name: harmonyos-traverse
description: 鸿蒙应用深度遍历 Router。对鸿蒙设备上的 App 进行自动化深度遍历，自动处理首启弹窗、权限请求、登录墙，逐屏截图并生成遍历报告。触发词：鸿蒙遍历、harmonyos traverse、深度遍历鸿蒙、遍历App鸿蒙、app遍历鸿蒙。
---

# 鸿蒙应用深度遍历

Router only. 调度各阶段子 skill 完成完整的深度遍历流程。

## 前置条件

- agent-device 已编译（`pnpm build`）
- 鸿蒙设备已连接，已开启开发者模式和 USB 调试
- 设备上已安装被测 App

## 遍历流程

```
1. 发现设备和应用 → harmonyos-traverse-setup
2. 预检（uitest 健康检查） → harmonyos-traverse-setup
3. 清除应用数据 → harmonyos-traverse-setup
4. 启动应用 → harmonyos-traverse-setup
5. 处理首启弹窗链 → harmonyos-traverse-dialogs
6. 深度遍历主循环 → harmonyos-traverse-explore
7. 生成报告 → harmonyos-traverse-report
```

## 使用方式

用户触发此 skill 后，按以下顺序执行：

1. 调用 `harmonyos-traverse-setup` 完成准备阶段
2. 调用 `harmonyos-traverse-dialogs` 处理首启弹窗
3. 调用 `harmonyos-traverse-explore` 执行深度遍历
4. 调用 `harmonyos-traverse-report` 生成报告

各阶段之间传递以下状态：
- `hdc-serial`: 设备序列号
- `bundleId`: 应用包名
- `launchAbility`: 启动入口
- `session`: 会话名称（默认 traverse）
- `outputDir`: 输出目录路径

## 关键规则（全流程通用）

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