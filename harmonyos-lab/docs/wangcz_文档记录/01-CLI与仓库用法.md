# CLI 与仓库用法

## 1. 前置条件

```bash
cd <agent-device-src>
pnpm install
pnpm build    # 生成 dist/，本地 mjs 才能用
```

- Node >= 22  
- HarmonyOS：`hdc` 可用，设备已连接（`hdc list targets`）  
- 首次操作建议：`node bin/agent-device.mjs help workflow`

---

## 2. 命令入口

| 方式 | 命令 | 说明 |
|------|------|------|
| 全局安装 | `agent-device …` | `npm install -g agent-device` 后 |
| **本仓库（推荐）** | `node bin/agent-device.mjs …` | 与当前分支代码一致 |
| 快捷 | `pnpm ad …` | 等同上一行 |

未 build 时会报错：`Missing dist build. Run pnpm build`。

---

## 3. 标准会话闭环

```bash
# 可选：确认设备与应用
node bin/agent-device.mjs devices --platform harmonyos
node bin/agent-device.mjs apps --platform harmonyos

# 1. 打开应用（必须先 open，才有 session）
node bin/agent-device.mjs open <包名> --platform harmonyos --session hs1

# 2. 看当前可交互元素
node bin/agent-device.mjs snapshot -i --platform harmonyos --session hs1

# 3. 操作（二选一或组合）
node bin/agent-device.mjs press 'label="微信登录"' --platform harmonyos --session hs1
node bin/agent-device.mjs press @e10 --platform harmonyos --session hs1

# 4. 结束（必须 close，释放 session）
node bin/agent-device.mjs close --platform harmonyos --session hs1
```

**习惯用法**：探索用 `@eN`（来自上一步 `-i`）；稳定脚本用 `'label="…"'` / `'id="…"'`。

---

## 4. 子命令速查

| 类别 | 命令 | 用途 |
|------|------|------|
| 会话 | `open` / `close` / `appstate` | 拉起应用、结束会话、看前台包名 |
| 观测 | `snapshot`、`-i`、`--json`、`--raw`、`-s @eN` | 读 UI；详见 [02](./02-snapshot-i与鸿蒙快照.md) |
| 交互 | `press` / `click` / `fill` / `scroll` / `back` | 点按、输入、滚动、返回 |
| 断言 | `is` / `get` / `find` / `wait` | 验证文案、状态、等待 |
| 规划 | `cognition --json` | 单屏 UI 结构概览（给模型做计划） |

---

## 5. 两条技术路线（勿混用）

```text
路线 A — 会话内手动/Agent 操作
  agent-device open → snapshot -i → press @eN 或 label=… → close

路线 B — 批量智能遍历（写 traverse-output 报告）
  run-smart-traverse-app.sh → hdc dumpLayout 全量 JSON → 坐标 press → 报告
```

| 对比项 | 路线 A | 路线 B |
|--------|--------|--------|
| UI 数据 | daemon `snapshot` | `uitest dumpLayout` 完整 JSON |
| 典型点击 | ref / selector | `press cx cy` |
| 产物 | 终端输出 | `smart-traverse-report.md` 等 |

路线 B 见 [06-traverse-output报告生成全流程.md](./06-traverse-output报告生成全流程.md)。
