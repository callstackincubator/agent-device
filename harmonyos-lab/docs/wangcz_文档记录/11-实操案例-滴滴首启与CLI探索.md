# 实操案例：滴滴首启与 CLI 探索

| 项 | 内容 |
|----|------|
| 日期 | 2026-05-27 |
| 包名 | `com.sdu.didi.hmos.psnger` |
| 设备 | `22M0223824043030` |
| 方式 | **仅 agent-device CLI**，不用遍历脚本 |
| 留痕目录 | `traverse-output/didi-cli-explore/` |

---

## 1. 为什么要 CLI 手操

智能遍历脚本对滴滴出现「点一次就停」；需用 CLI 验证：**是 App 问题还是脚本问题**。结论见 [12-遍历脚本已知问题与改法](./12-遍历脚本已知问题与改法.md)。

---

## 2. 会话准备

```bash
pnpm build

# 复现首启（无 CLI 封装，直接 hdc）
hdc -t 22M0223824043030 shell bm clean -n com.sdu.didi.hmos.psnger -d
hdc -t 22M0223824043030 shell bm clean -n com.sdu.didi.hmos.psnger -c

AD="node dist/src/cli.js --platform harmonyos --device 22M0223824043030 \
  --session didi-cli-explore --state-dir /private/tmp/agent-device-didi-cli-explore"

$AD open com.sdu.didi.hmos.psnger --activity EntryAbility --json
```

launchAbility 也可省略，由 wukong 自动解析，见 [09](./09-鸿蒙平台能力补全-路由与启动.md)。

---

## 3. 首启权限链（固定顺序）

### Step A — App 内隐私弹窗

```bash
$AD snapshot -i
# 12 nodes：地区选择 + @e11「同意并开始使用」

$AD click @e11
$AD appstate --json   # 仍为 com.sdu.didi.hmos.psnger
```

**要点**：用 `click @ref`，不要用裸 `press` 坐标（脚本曾因此跳进 `privacycenter`）。

### Step B — 应用内位置权限

```bash
$AD snapshot -i
# 32 nodes：「本次使用允许」「仅使用期间允许」「不允许」

$AD click label="本次使用允许"
```

### Step C — 系统通知权限（系统 uiextension）

```bash
$AD snapshot -i
# ⚠ 仅 1 node「不允许」— 严重漏检

$AD snapshot
# 全树 66 nodes：@e24「允许」、@e22「不允许」

$AD click @e24
```

**要点**：系统 overlay 阶段必须用 **`snapshot` 全树**，不能单靠 `-i`。见 [02-snapshot-i与鸿蒙快照](./02-snapshot-i与鸿蒙快照.md)。

### Step D — 主界面

```bash
$AD snapshot -i
# ~114 nodes：北京、天工大厦、您想去哪儿、业务网格、底部 Tab
```

---

## 4. 主界面探索片段

### 4.1 业务网格「打车」

```bash
$AD click label="打车"
$AD snapshot -i    # 37 nodes：输入您的目的地
$AD back
# back 后易进入更深导航，label=首页 可能匹配失败
```

### 4.2 底部 Tab

| Tab | ref（示例） | 结果 |
|-----|-------------|------|
| 我的 | @e114 | 登录页（手机号 + 下一步），29 nodes |
| 车主 | @e108 | 坐标 (324, 2387) |

**Tab 注意**：`label=送货` 与网格项重名；优先用 `@eN` 或先 `snapshot -i` 定位 Tab 行。

### 4.3 导航恢复

子页 `back` 回不到 Tab 根时：

```bash
hdc -t 22M0223824043030 shell aa force-stop com.sdu.didi.hmos.psnger
$AD open com.sdu.didi.hmos.psnger --activity EntryAbility
# 隐私不再弹（已持久化）；位置弹窗可能仍出现 → 再点「本次使用允许」
```

---

## 5. 路径树（CLI 实测）

```text
root
├─ [privacy] click @e11 同意并开始使用 ✓
├─ [location] click label=本次使用允许 ✓
├─ [notify] click @e24 允许 ✓（需 snapshot 全树）
└─ [home] 主界面 ~114 nodes
   ├─ [grid] 打车 → 目的地页 → back 易迷路
   ├─ [tab] 我的 → 登录页
   └─ [tab] 车主 → 已点击
```

---

## 6. 覆盖度粗估（当日）

| 维度 | 进度 |
|------|------|
| 首启链路（隐私+权限） | 100% |
| 主界面业务格（~16） | ~6%（仅「打车」） |
| 底部 Tab（5） | 40%（我的、车主） |
| 综合 | 远低于 80%；需 Tab×网格循环 + `open` 恢复 |

---

## 7. 推荐 CLI 探索循环

```bash
$AD open com.sdu.didi.hmos.psnger --activity EntryAbility
$AD snapshot -i
$AD click @eN                    # 或 label=
$AD snapshot                     # 系统弹窗时用全树
$AD appstate --json
$AD back
hdc shell aa force-stop com.sdu.didi.hmos.psnger
$AD close
```

---

## 8. 截图与留痕

| 路径 | 说明 |
|------|------|
| `traverse-output/didi-cli-explore/cli-explore-trace.md` | 决策日志（可归档副本） |
| `traverse-output/didi-cli-explore/screens/step3-home.png` | 主界面 |
| `traverse-output/didi-cli-explore/screens/tab-我的.png` | 我的 Tab |

终端对比实录：[附录-终端实录-滴滴脚本vsCLI对比](./附录-终端实录-滴滴脚本vsCLI对比.md)
