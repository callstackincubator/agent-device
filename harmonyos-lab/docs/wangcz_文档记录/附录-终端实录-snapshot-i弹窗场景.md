# 附录：终端实录 — snapshot -i 弹窗场景

原始问答中的终端输出，整理便于对照 **过滤前 / 改代码未 build / 改代码已 build（scope）** 三种情况。

---

## 场景 A：弹窗出现，但未 build 新代码（49 nodes）

仍列出**登录页背景** + **弹窗** + 状态栏碎片。

```bash
node bin/agent-device.mjs snapshot -i --platform harmonyos --session hs1
```

```text
Snapshot: 49 nodes
@e13 [text] "微信登录"
@e15 [text] "其他登录方式"
@e31 [text] "请阅读并同意以下条款"
@e38 [text] "同意并继续"
@e26 [navdestination] "5474" [focused]
…（另有 stack/column/状态栏时间等）
```

**问题**：用户 `press @e15`（其他登录方式）→ `Tapped @e15 (1113, 1968)`，但弹窗挡住背景，**界面无变化**。

---

## 场景 B：build 后 + focused scope（13 nodes）

仅保留 **focused 弹窗子树**，适合作为当前可操作列表。

```text
Snapshot: 13 nodes
@e1  [navdestination] "5474" [focused]
@e6  [text] "请阅读并同意以下条款"
@e11 [text] "不同意"
@e13 [text] "同意并继续"
…
```

**建议操作**：

```bash
node bin/agent-device.mjs press 'label="同意并继续"' --platform harmonyos --session hs1
```

---

## 场景 C：点击「微信登录」触发弹窗

```bash
node bin/agent-device.mjs press @e13 --platform harmonyos --session hs1
# Tapped @e13 (1113, 1790)

node bin/agent-device.mjs snapshot -i --platform harmonyos --session hs1
# → 应进入场景 B（若已 build）；否则仍可能为场景 A
```

---

## 场景 D：登录页过滤优化（历史对比）

| 阶段 | nodes 约数 | 说明 |
|------|------------|------|
| interactiveOnly 改前 | ~88 | 大量布局与无关文案 |
| 收紧过滤后（无弹窗） | ~23–36 | 如 `@e10 [button]` + `@e11 [text] "微信登录"` |

---

## 关键结论（实录归纳）

1. **`Tapped` ≠ UI 变化**：模态层下背景控件仍可被坐标命中。  
2. **弹窗时应以 focused 子树为准**：build 后约 13 nodes；不应再信背景里的 `@e15`。  
3. **优先 selector**：`press 'label="同意并继续"'` 比死记 `@eN` 稳。  

实现细节见 [04-鸿蒙代码修改记录.md](./04-鸿蒙代码修改记录.md)。
