# 滴滴 CLI 手工探索留痕

> **已归档至** [`wangcz_文档记录/11-实操案例-滴滴首启与CLI探索.md`](../wangcz_文档记录/11-实操案例-滴滴首启与CLI探索.md)  
> 脚本对比实录：[`附录-终端实录-滴滴脚本vsCLI对比.md`](../wangcz_文档记录/附录-终端实录-滴滴脚本vsCLI对比.md)  
> 改法清单：[`12-遍历脚本已知问题与改法.md`](../wangcz_文档记录/12-遍历脚本已知问题与改法.md)

- 设备: `22M0223824043030`
- Session: `didi-cli-explore`
- 包名: `com.sdu.didi.hmos.psnger`
- 方式: **仅 agent-device CLI**，不用遍历脚本

## 决策日志

### Step 0 — 重置首启状态
- **动作**: `hdc bm clean -d/-c`（无 CLI 封装，直接 hdc）
- **原因**: 隐私同意会持久化，需清 data 才能复现首启弹窗

### Step 1 — 打开应用
```bash
agent-device open com.sdu.didi.hmos.psnger --activity EntryAbility \
  --platform harmonyos --device 22M0223824043030 \
  --session didi-cli-explore --state-dir /private/tmp/agent-device-didi-cli-explore
```
- **结果**: 成功，3.2s 启动

### Step 2 — 首屏隐私弹窗 (snapshot -i: 12 nodes)
- **观察**: 地区选择 + 「同意并开始使用」@e11 + 「不同意」
- **决策**: 点 @e11（不用裸 press）
- **命令**: `click @e11`
- **关键发现**: `click @ref` 后 appstate 仍为滴滴；**脚本用 press 坐标曾跳进 privacycenter**

### Step 3 — 应用内位置权限 (32 nodes)
- **观察**: 「允许滴滴出行访问位置」+ 本次使用/仅期间/不允许
- **决策**: `click label="本次使用允许"`

### Step 4 — 系统通知权限 (full tree 66 nodes, -i 仅 1 node!)
- **观察**: 系统 uiextension 弹窗「允许发送通知？」
- **决策**: 先 `snapshot` 全树找 @e24「允许」，再 `click @e24`
- **脚本优化点**: `-i` 在系统 overlay 场景会严重漏节点，弹窗处理应走全树或专门 alert 命令

### Step 5 — 主界面 (114 nodes)
- **观察**: 城市「北京」、上车点「天工大厦」、搜索「您想去哪儿？」
- **业务入口**: 打车/顺风车/代驾/城际拼车/青桔骑行/特价拼车/快送跑腿/借钱…
- **下一步**: 按 Tab + 业务网格 DFS 探索

### Step 6 — 业务入口「打车」
- **命令**: `click label="打车"`
- **结果**: 进入打车子页（37 nodes），「输入您的目的地」
- **返回**: `back` → 进入更深导航（非 Tab 根），`label=首页` 匹配失败

### Step 7 — Tab「我的」@e114
- **结果**: 登录页（手机号 + 下一步），29 nodes
- **留痕**: `screens/tab-我的.png`

### Step 8 — Tab「车主」@e108
- **坐标**: (324, 2387)
- **恢复策略**: `aa force-stop` + `open` + 再点「本次使用允许」（位置弹窗仍会出）

## 路径树（CLI 实测）

```
root
├─ [privacy] click @e11 同意并开始使用 ✓  (appstate 保持滴滴)
├─ [location] click label=本次使用允许 ✓
├─ [notify] click @e24 允许 ✓  (需 snapshot 全树，-i 仅 1 node)
└─ [home] 主界面 ~114 nodes
   ├─ [grid] 打车 → 目的地页 → back 易迷路
   ├─ [tab] 我的 → 登录页
   └─ [tab] 车主 → (已点，session 关闭前未完成截图)
```

## 脚本应如何改（对比本次 CLI 探索）

| 现象 | 脚本现状 | 建议 |
|------|----------|------|
| 点「同意」后进 `privacycenter` | `press 540 1722` 裸坐标 | 改用 **`click @ref` / `click label=`**，与 CLI 一致 |
| 同意 1 次就结束 | modal 模式 `plan.length===1` 后 `break` | 同意后 **re-dump + 继续本屏**，不要退出 `exploreScreen` |
| 系统通知弹窗漏检 | 只用 `snapshot -i` | 权限链阶段用 **`snapshot` 全树** 或专用 alert/overlay 检测 |
| 权限未串行处理 | 只认 App 内隐私文案 | 固定阶段：`隐私 → 位置(应用内) → 通知(系统 uiextension)` |
| `back` 回不到 Tab | 依赖 `back` 回根 | 子导航迷路时用 **`open` 或 force-stop + open`**（探索已验证） |
| `wrong_app` 误杀 | 点同意即 recover+break | 仅当 **appstate 包名** 非目标且非短暂 overlay 时 recover；`click` 路径下很少触发 |
| Tab `label=车主` 失败 | 子页无 Tab 文案 | 先 **回到主界面** 再点 Tab；或缓存 Tab 坐标/ref |
| 清数据 | 每轮 `bm clean` | **仅首轮**清 data；后续轮用 force-stop 保留已授权状态 |
| 探索深度 | `MAX_DEPTH=2` 默认 | 主界面网格 + 5 Tab 建议 **depth≥4**，targets≥16 |

## 推荐 CLI 探索循环（给人/Agent 手操，不写脚本）

```bash
AD="node dist/src/cli.js --platform harmonyos --device 22M0223824043030 \
  --session didi-cli-explore --state-dir /private/tmp/agent-device-didi-cli-explore"

$AD open com.sdu.didi.hmos.psnger --activity EntryAbility
$AD snapshot -i                    # 看 ref
$AD click @e11                     # 或 label=
$AD snapshot                       # 系统弹窗时用全树
$AD appstate --json
$AD click label="打车"
$AD back
hdc shell aa force-stop com.sdu.didi.hmos.psnger   # 迷路时重置
$AD close
```

## 覆盖度粗估

- **首启链路**（隐私+权限）: 已走通 100%
- **主界面网格**（~16 入口）: 仅「打车」1/16 ≈ 6%
- **底部 Tab**（5）: 「我的」「车主」2/5 = 40%
- **综合**: 远低于 80%；要达标需按上表循环 Tab×网格，并用 `snapshot -i` + `click` + `open` 恢复，**不要**再跑旧版 `smart-traverse-from-cognition.mjs` 直到按上表改完。
