---
name: harmonyos-traverse-setup
description: 鸿蒙遍历准备阶段。发现设备、预检 uitest、清除应用数据、启动应用。触发词：鸿蒙遍历准备、harmonyos traverse setup。
---

# 鸿蒙遍历准备阶段

完成遍历前的准备工作：发现设备和应用、预检、清除数据、启动应用。

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

## 输出状态

准备阶段完成后，向下一阶段传递：

- `hdc-serial`: 设备序列号
- `bundleId`: 应用包名
- `launchAbility`: 启动入口
- `session`: traverse
- `outputDir`: harmonyos-lab/reports/traverse-<bundleId>-<日期>/