# 附录：终端实录 — 滴滴脚本 vs CLI 对比

| 项 | 内容 |
|----|------|
| 日期 | 2026-05-27 |
| 包名 | `com.sdu.didi.hmos.psnger` |
| 设备 | `22M0223824043030` |

---

## 1. 脚本跑滴滴（`didi-long-1h` / `didi-smart`）

来源：`traverse-output/didi-long-1h/run.log`（节选）

```text
=== 清理 com.sdu.didi.hmos.psnger 存储 (data=true, cache=true) ===
clean bundle data files successfully.
=== launchAbility (apps --json): EntryAbility ===
=== 打开 com.sdu.didi.hmos.psnger ===
{ "success": true, "data": { "message": "Opened: com.sdu.didi.hmos.psnger" } }

=== 界面 s1_d0 (depth=0) nodes=66 ===
  前台: com.sdu.didi.hmos.psnger
  弹窗模式: 仅点击同意/确定类按钮
  计划点击: 1 个
  -> 点击 1/1: [modal-accept] press 540 1722 (同意并开始使用)
     ! 点击后离开目标应用 (wrong_app)，不递归
  [recover] wrong_app → 重新拉起 com.sdu.didi.hmos.psnger

[决策] 第 2 轮（已访界面 1）
  [guard] 停止遍历: wrong_app (
    appstate=com.sdu.didi.hmos.psnger,
    focused=com.huawei.hmos.security.privacycenter,
    bundles=com.huawei.hmos.security.privacycenter,com.ohos.sceneboard)
```

**解读**：`press` 后 layout 出现 `privacycenter`，脚本判 wrong_app 并终止；第 2 轮 focused 仍为 privacycenter，无法继续。

---

## 2. CLI 手操（同 App、同设备）

### 2.1 隐私同意

```text
$ snapshot -i
Page: com.sdu.didi.hmos.psnger
Snapshot: 12 nodes
@e11 [button] "同意并开始使用"

$ click @e11
{ "success": true, "data": { "message": "Tapped @e11 (540, 1722)" } }

$ appstate --json
{ "appBundleId": "com.sdu.didi.hmos.psnger", "state": "foreground" }
```

### 2.2 位置权限

```text
$ snapshot -i
Snapshot: 32 nodes
@e28 [text] "本次使用允许"
...

$ click label="本次使用允许"
{ "success": true }
```

### 2.3 系统通知（-i 漏检）

```text
$ snapshot -i
Snapshot: 1 nodes
@e1 [button] "不允许" [focused]

$ snapshot
Snapshot: 66 nodes
...
@e22 [button] "不允许"
@e24 [button] "允许"

$ click @e24
{ "success": true, "data": { "refLabel": "允许" } }
```

### 2.4 主界面

```text
$ snapshot -i
Snapshot: 114 nodes
@e23 [text] "北京"
@e45 [text] "从 ​天工大厦​ 上车"
@e48 [text] "您想去哪儿？"
@e56 [text] "打车"
...
@e106 [text] "首页"
@e108 [text] "车主"
@e114 [text] "我的"
```

---

## 3. 对比小结

| 步骤 | 脚本 `press 540 1722` | CLI `click @e11` |
|------|----------------------|------------------|
| 坐标 | 相同 (540, 1722) | 相同 |
| appstate 后 | wrong_app / privacycenter | 仍 foreground 滴滴 |
| 后续 | recover → 结束 | 位置 → 通知 → 主界面 114 nodes |

| 快照模式 | 节点数（通知弹窗时） | 能否点「允许」 |
|----------|---------------------|----------------|
| `snapshot -i` | 1 | 否（只有「不允许」） |
| `snapshot` 全树 | 66 | 是（@e24） |

---

## 4. 相关文档

- [11-实操案例-滴滴首启与CLI探索](./11-实操案例-滴滴首启与CLI探索.md)
- [12-遍历脚本已知问题与改法](./12-遍历脚本已知问题与改法.md)
- [09-鸿蒙平台能力补全-路由与启动](./09-鸿蒙平台能力补全-路由与启动.md)
