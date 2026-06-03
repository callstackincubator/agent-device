# snapshot -i 与鸿蒙快照

## 1. 这条命令在做什么

```bash
node bin/agent-device.mjs snapshot -i --platform harmonyos --session hs1
```

| 片段 | 含义 |
|------|------|
| `snapshot` | 抓取当前界面的 UI 树（鸿蒙侧：`hdc uitest dumpLayout` → 解析） |
| `-i` | **interactiveOnly**：只保留与「下一步操作」相关的节点 |
| `--platform harmonyos` | 走 ArkUI 后端 |
| `--session hs1` | 绑定已 `open` 的会话（设备、前台应用） |

输出不是截图，而是**带 `@eN` 引用的文本列表**，供 `press @eN` 或人工阅读。

---

## 2. 一行输出怎么读

```text
@e11 [text] "微信登录"
@e10 [button] "5388"
@e8  [scroll] "5379" [scrollable]
@e1  [navdestination] "9322" [focused]
```

| 部分 | 说明 |
|------|------|
| `@e11` | 本快照内临时编号；界面变化后需重新 `snapshot -i` |
| `[text]` / `[button]` | ArkUI 组件类型 |
| `"微信登录"` | 显示名：优先 text/description；无文案则为内部 id |
| `[focused]` | 焦点在该节点或其层 |
| `[scrollable]` | 可滚动容器 |

**点击建议**：有 `[button]` 时优先点 button 或 `press 'label="微信登录"'`；单独 `[text]` 可能只是标签，不一定接收点击。

---

## 3. 引号里是数字（如 9329、5388）时

表示该节点**没有可读文案**，退化为 `id` / `key` / `accessibilityId`。

- `@e3 [stack] "9329"` → 布局壳，一般**不要**当业务按钮  
- `@e10 [button] "5388"` + `@e11 [text] "微信登录"` → 业务上点「微信登录」或 `@e10`

---

## 4. `-i` 不是完整树

完整数据在设备上的 **嵌套 JSON**（`attributes` + `children[]`），字段含 `type`、`text`、`clickable`、`bounds`、`focused`、`visible` 等。

**需要更多细节时的升级路径**：

| 命令 | 何时用 |
|------|--------|
| `snapshot -i` | 日常点按、省 token |
| `snapshot -i --json` | 看 `hittable`、`rect`、`identifier` |
| `snapshot -s @e10` | 展开某个 ref 子树 |
| `snapshot -c` / 无 `-i` | 更多可见结构 |
| `snapshot --raw` | 接近全量节点 |
| `hdc … dumpLayout` | 与智能遍历脚本相同的完整树 |

**结论**：过滤只影响默认打印内容，不删除设备上的完整树。Agent 可按需升级视图，见 [03-agent-device封装思路.md](./03-agent-device封装思路.md)。

---

## 5. 与 Android 的 `-i` 差异

| 维度 | Android | HarmonyOS（改前） | HarmonyOS（改后，2026-05-27） |
|------|---------|-------------------|-------------------------------|
| 过滤思路 | 祖先/后代可交互 + 结构类型 | 有 text/id 就保留 → **偏松** | 仅交互上下文 + focused 弹窗 scope |
| 终端观感 | 较像「关键可点列表」 | 节点多、易含背景 | 节点少；弹窗场景以当前层为主 |
| 实现文件 | `ui-hierarchy.ts` | `arkui-hierarchy.ts` | 同左 |

---

## 6. 过滤效果（实测量级）

| 场景 | 大约 nodes | 说明 |
|------|------------|------|
| 登录页，改前 | ~88 | 大量布局 + 文案噪音 |
| 登录页，改后 | ~23–36 | 收敛到交互相关 |
| 隐私弹窗 + **未** build 新代码 | ~49 | 仍含背景「微信登录」等（旧 dist） |
| 隐私弹窗 + **已** build + scope | ~13 |  mainly `navdestination [focused]` 子树 |

弹窗场景终端对比见 [附录-终端实录-snapshot-i弹窗场景.md](./附录-终端实录-snapshot-i弹窗场景.md)。

代码说明见 [04-鸿蒙代码修改记录.md](./04-鸿蒙代码修改记录.md)。
