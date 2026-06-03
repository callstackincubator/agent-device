# wangcz 文档记录

本目录整理 **agent-device-src** 近期问答、鸿蒙 `snapshot -i` 优化、登录/弹窗实操，以及 **`traverse-output` 报告** 的生成方式。

| 项 | 说明 |
|----|------|
| 整理日期 | 2026-05-27 ~ 2026-05-28 |
| 适用平台 | HarmonyOS（部分内容通用于全平台 CLI） |
| 代码改动 | `src/platforms/harmonyos/arkui-hierarchy.ts`（需 `pnpm build` 后生效） |

---

## 建议阅读顺序

1. [01-CLI与仓库用法.md](./01-CLI与仓库用法.md) — 怎么在本仓库跑 CLI  
2. [02-snapshot-i与鸿蒙快照.md](./02-snapshot-i与鸿蒙快照.md) — `-i` 输出怎么读、和完整树的关系  
3. [03-agent-device封装思路.md](./03-agent-device封装思路.md) — 为什么有 ref/selector、会不会丢信息  
4. [04-鸿蒙代码修改记录.md](./04-鸿蒙代码修改记录.md) — 本次过滤逻辑改了什么  
5. [05-实操案例-登录与弹窗.md](./05-实操案例-登录与弹窗.md) — 微信登录 + 隐私弹窗命令清单  
6. [06-traverse-output报告生成全流程.md](./06-traverse-output报告生成全流程.md) — 批量遍历报告怎么来的  
7. [07-深度概念与遍历调参.md](./07-深度概念与遍历调参.md) — UI 树深度 vs 遍历深度、`TRAVERSE_*` 推荐值  
8. [08-DevEco探索测试逆向与结论.md](./08-DevEco探索测试逆向与结论.md) — DevEco ONNX/JAR 逆向全过程与盖章结论  
9. [09-鸿蒙平台能力补全-路由与启动.md](./09-鸿蒙平台能力补全-路由与启动.md) — 路由修复、wukong launchAbility、清 storage、uitest 预检
10. [13-鸿蒙基础命令修复与能力补全.md](./13-鸿蒙基础命令修复与能力补全.md) — scroll/rotate/keyboard/doubleTap 修复实现
11. [14-skill文件更新-AI能力发现.md](./14-skill文件更新-AI能力发现.md) — skill description 补 HarmonyOS + 禁用原始 HDC 命令
12. [11-实操案例-滴滴首启与CLI探索.md](./11-实操案例-滴滴首启与CLI探索.md) — 滴滴首启权限链 + CLI 手操探索
13. [12-遍历脚本已知问题与改法.md](./12-遍历脚本已知问题与改法.md) — 脚本「点一次就停」根因与改法清单
14. [附录-终端实录-snapshot-i弹窗场景.md](./附录-终端实录-snapshot-i弹窗场景.md) — 原始终端输出与对比
15. [15-从快照提取Web内容全文.md](./15-从快照提取Web内容全文.md) — snapshot 不带 -i 可拿到 [web] 节点 URL，webReader 抓全文
16. [16-H5页面定位截图课题.md](./16-H5页面定位截图课题.md) — H5 长页面关键词定位与快速截图（课题）
17. [附录-终端实录-滴滴脚本vsCLI对比.md](./附录-终端实录-滴滴脚本vsCLI对比.md) — 同按钮 press vs click 终端对比

---

## 文档分类索引

| 分类 | 文件 | 一句话 |
|------|------|--------|
| 使用入门 | [01](./01-CLI与仓库用法.md) | `node bin/agent-device.mjs` + `open → snapshot -i → press → close` |
| 快照语义 | [02](./02-snapshot-i与鸿蒙快照.md) | `-i` 是「可操作投影」，不是完整 UI 树 |
| 架构 | [03](./03-agent-device封装思路.md) | parse → resolve → act → verify |
| 代码 | [04](./04-鸿蒙代码修改记录.md) | 收紧 interactiveOnly + focused 弹窗 scope |
| 平台能力 | [09](./09-鸿蒙平台能力补全-路由与启动.md) | 鸿蒙路由、wukong、bm clean、uitest 预检 |
| 平台能力 | [13](./13-鸿蒙基础命令修复与能力补全.md) | scroll 四方向修复、rotate/keyboard/doubleTap 实现 |
| AI 发现 | [14](./14-skill文件更新-AI能力发现.md) | skill description 补 HarmonyOS + 禁 HDC 原生 |
| 实操 | [05](./05-实操案例-登录与弹窗.md) | 弹窗时别点背景里的「其他登录方式」 |
| 实操 | [11](./11-实操案例-滴滴首启与CLI探索.md) | 滴滴首启链：click @ref + 全树处理系统通知 |
| 遍历 | [06](./06-traverse-output报告生成全流程.md) | `run-smart-traverse-app.sh` 全链路 |
| 遍历 | [12](./12-遍历脚本已知问题与改法.md) | press vs click、modal 单点退出、改法 backlog |
| 调参 | [07](./07-深度概念与遍历调参.md) | `treeDepth` vs `depth`、环境变量与 App 推荐组合 |
| DevEco 逆向 | [08](./08-DevEco探索测试逆向与结论.md) | 探索测试/ONNX/JAR 全过程；产品行、裸 ONNX 不行 |
| 实录 | [附录-snapshot-i](./附录-终端实录-snapshot-i弹窗场景.md) | 49 nodes vs 13 nodes 终端对比 |
| 实录 | [附录-滴滴](./附录-终端实录-滴滴脚本vsCLI对比.md) | 脚本 press 失败 vs CLI click 成功 |
| 技巧 | [15](./15-从快照提取Web内容全文.md) | snapshot 不带 `-i` 拿 web URL → webReader 抓全文 |
| 课题 | [16](./16-H5页面定位截图课题.md) | H5 关键词定位截图：按比例滚动 + AI 看图确认（待深入） |

---

## 常见问题（速查）

**Q：`snapshot -i` 和 `hdc dumpLayout` 有什么区别？**  
A：`-i` 经 agent-device 解析并过滤，给 agent 做点按；`dumpLayout` 是完整 ArkUI JSON，智能遍历脚本用它做规划。见 [02](./02-snapshot-i与鸿蒙快照.md)、[06](./06-traverse-output报告生成全流程.md)。

**Q：`Tapped @e15` 但界面没变？**  
A：常见于模态弹窗挡住背景；命令成功 ≠ 业务生效。改点弹窗内「同意并继续」或 `label="..."`。见 [05](./05-实操案例-登录与弹窗.md)。

**Q：改了代码为什么还是 49 nodes？**  
A：需 `pnpm build` 后再跑 `node bin/agent-device.mjs`；未 build 仍用旧 `dist`。见 [04](./04-鸿蒙代码修改记录.md)。

**Q：`"9329"` 这种数字是什么？**  
A：无文案时的内部 id，不是按钮名。优先看 `"微信登录"`、`[button]`。见 [02](./02-snapshot-i与鸿蒙快照.md)。

**Q：为什么遍历只有 3 层？`dumpLayout` 是不是也只 dump 3 层？**  
A：那是 **遍历界面深度**（默认 `TRAVERSE_MAX_DEPTH=2` → 3 屏），不是 UI 树深度；单屏 `treeDepth` 常十几层以上。见 [07](./07-深度概念与遍历调参.md)。

**Q：滴滴遍历点一次「同意」就停了？**  
A：脚本用 `press` 坐标易判 `wrong_app`；CLI `click @e11` 可继续首启链。见 [11](./11-实操案例-滴滴首启与CLI探索.md)、[12](./12-遍历脚本已知问题与改法.md)。

**Q：系统通知弹窗 `-i` 只有一个「不允许」？**  
A：系统 uiextension 在 `-i` 投影外；用 `snapshot` 全树找「允许」。见 [11](./11-实操案例-滴滴首启与CLI探索.md)  Step C。

**Q：怎么重置隐私弹窗？**  
A：`hdc shell bm clean -n <包名> -d/-c`，或遍历脚本默认 `TRAVERSE_CLEAR_APP_STORAGE=1`。见 [09](./09-鸿蒙平台能力补全-路由与启动.md)。

**Q：`dumpLayout` 超时 / 0 字节 JSON？**  
A：设备上可能有 stuck `uitest uiRecord record`，需重启；跑 `node scripts/ensure-harmony-uitest-ready.mjs`。见 [09](./09-鸿蒙平台能力补全-路由与启动.md)。

**Q：鸿蒙 `scroll` 方向不对？**  
A：2026-05-28 已修复；`scroll up` = 内容上滚，`scroll down` = 内容下滚。使用 `buildScrollGesturePlan` 与 Android/iOS 一致。见 [13](./13-鸿蒙基础命令修复与能力补全.md)。

**Q：鸿蒙 `rotate` / `keyboard` 不支持？**  
A：已实现。`rotate portrait/landscape-left`、`keyboard status/dismiss` 现可用。见 [13](./13-鸿蒙基础命令修复与能力补全.md)。

**Q：为什么 AI 用 `hdc shell` 原始命令而不是 agent-device CLI？**  
A：skill description 未提及 HarmonyOS 导致 AI 误判。现已更新 SKILL.md，明确禁止原始命令。见 [14](./14-skill文件更新-AI能力发现.md)。

---

## 常用命令

```bash
pnpm build

# 会话内操作
node bin/agent-device.mjs open <包名> --platform harmonyos --session hs1
node bin/agent-device.mjs snapshot -i --platform harmonyos --session hs1
node bin/agent-device.mjs press 'label="微信登录"' --platform harmonyos --session hs1
node bin/agent-device.mjs close --platform harmonyos --session hs1

# 批量遍历报告
export TRAVERSE_DEVICE=<hdc-serial>
export TRAVERSE_HDC_TARGET=<hdc-serial>
./scripts/run-smart-traverse-app.sh <包名> [Ability] ./traverse-output/<目录>

# 滴滴 CLI 手操探索（改脚本前建议先走通）
# 见 11-实操案例-滴滴首启与CLI探索.md
```

---

## 仓库内相关路径

| 路径 | 作用 |
|------|------|
| `skills/agent-device/SKILL.md` | Agent 技能路由 |
| `smart-traverse-workflow.md` | 认知地图 + 遍历概念说明 |
| `scripts/run-smart-traverse-app.sh` | 一键遍历入口 |
| `scripts/smart-traverse-from-cognition.mjs` | 遍历核心逻辑（**不集成 ONNX**） |
| `onnx-deveco-probe/` | DevEco 模型研究归档（见 [08](./08-DevEco探索测试逆向与结论.md)） |
| `scripts/build-cognition-map.js` | 单屏认知地图 |
| `scripts/clear-harmony-app-storage.mjs` | 遍历前 bm clean |
| `scripts/ensure-harmony-uitest-ready.mjs` | uitest stuck 预检 |
| `scripts/resolve-harmony-launch-ability.mjs` | 从 apps --json 解析 Ability |
| `traverse-output/didi-cli-explore/` | 滴滴 CLI 手操留痕（截图 + trace） |
| `scripts/merge-app-map.js` | 多屏合并为 app-map |
| `src/platforms/harmonyos/arkui-hierarchy.ts` | 鸿蒙 snapshot 过滤实现 |
