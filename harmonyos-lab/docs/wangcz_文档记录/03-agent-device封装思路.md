# agent-device 封装思路

## 1. 目标

让 AI agent 稳定完成闭环，而不用每次：

- 看截图猜坐标  
- 解析整棵原始 UI 树  
- 用 `adb`/`hdc` 原始命令拼凑流程  

```text
看界面 → 找元素 → 点/输/滚 → 验证
```

---

## 2. 数据流（HarmonyOS）

```text
uitest dumpLayout (设备)
       ↓
parseArkUiTree + buildArkUiSnapshot（可按 -i / -c / --raw 过滤）
       ↓
nodes[] + attachRefs → @e1, @e2, …
       ↓
终端文本 或 --json
       ↓
press / fill / is / wait（daemon：parse → resolve → act）
```

---

## 3. 两种定位方式

| 方式 | 示例 | 适用 |
|------|------|------|
| **ref** | `press @e11` | 当前屏探索；界面变则 ref 失效 |
| **selector** | `press 'label="微信登录"'` | 脚本、跨步骤、可 replay |

推荐组合：**`-i` 发现界面 → selector 执行关键步骤**。

---

## 4. 点击与验证

```text
parse(目标) → resolve(当前 UI 找节点) → act(press/fill/…) → verify(is/wait/再 snapshot)
```

注意：

- `Tapped @e15 (x, y)` 只表示**命令层**在坐标上执行成功  
- 模态弹窗、遮罩、误点背景文案时，**界面可以不变**  
- 必须用 `snapshot -i`、`is visible`、`wait` 等做业务验证  

---

## 5. Agent 如何避免「过滤丢关键信息」

按成本从低到高 escalation：

| 级别 | 做法 |
|------|------|
| L1 | `snapshot -i` + `press 'label="…"'` |
| L2 | 无反应 → 改点父级 `[button]`；`snapshot -i --json` 看 `hittable` |
| L3 | `snapshot -s @eN`、`snapshot -c` |
| L4 | `snapshot --raw` 或 `hdc dumpLayout` + `build-cognition-map.js` |
| L5 | 批量探索 → [06](./06-traverse-output报告生成全流程.md) |

**设计原则**：默认给「可操作投影」；完整树始终在设备/文件里，需要时再取。

---

## 6. 与智能遍历脚本的关系

| | 手动 CLI `snapshot -i` | `smart-traverse-from-cognition.mjs` |
|--|------------------------|-------------------------------------|
| UI | 过滤后的 nodes 列表 | 完整 `layouts/*.json` |
| 点击 | ref / selector | layout 中心坐标 `press cx cy` |
| 产物 | 无持久报告 | `smart-traverse-report.*` |

互补：遍历负责**广度 + 报告**；CLI 负责**会话内精确操作**（尤其弹窗、表单、断言）。
