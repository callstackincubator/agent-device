---
name: harmonyos-traverse-commands
description: 鸿蒙遍历命令速查。agent-device CLI 常用命令快速参考。触发词：鸿蒙遍历命令、harmonyos traverse commands。
---

# 鸿蒙遍历命令速查

agent-device CLI 常用命令快速参考。

## 设备和应用

```bash
agent-device devices --platform harmonyos
agent-device apps --platform harmonyos --device <serial> --json
agent-device open <bundleId> --platform harmonyos --device <serial> --session traverse
agent-device close --platform harmonyos --device <serial> --session traverse
```

## UI 交互

```bash
agent-device snapshot -i --platform harmonyos --device <serial> --session traverse
agent-device snapshot --platform harmonyos --device <serial> --session traverse
agent-device screenshot <path> --platform harmonyos --device <serial> --session traverse
agent-device press 'label="同意"' --platform harmonyos --device <serial> --session traverse
agent-device press @e5 --platform harmonyos --device <serial> --session traverse
agent-device scroll down --platform harmonyos --device <serial> --session traverse
agent-device back --platform harmonyos --device <serial> --session traverse
agent-device wait 2000 --platform harmonyos --device <serial> --session traverse
agent-device home --platform harmonyos --device <serial> --session traverse
```

## 清除数据（HDC 原始命令）

```bash
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