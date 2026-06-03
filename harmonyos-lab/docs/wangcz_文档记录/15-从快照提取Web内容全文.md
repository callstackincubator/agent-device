# 15 - 从快照提取 Web 内容全文

| 项 | 说明 |
|----|------|
| 发现日期 | 2026-05-29 |
| 适用平台 | HarmonyOS（Web 组件通用） |
| 场景 | 191号文合规检测、隐私政策全文提取 |

---

## 问题

`snapshot -i` 只能看到当前屏幕可见区域的文本。隐私政策等内容在 Web 组件中展示，要看完需要反复 `scroll down` + `screenshot`，效率低且可能遗漏。

## 方法

**两步获取完整 Web 页面内容**：

### 步骤1：用完整快照（不带 `-i`）找到 `[web]` 节点的 URL

```bash
agent-device snapshot --platform harmonyos --device <hdc-serial> --session <name>
```

输出中 `[web]` 节点会携带完整 URL：

```
@e12 [web] "https://www.xiaohongshu.com/crown/community/privacy_intl?tab=0&sid=session.1779964628424215749571&themeType=dark&xhs-statusbar-height=38"
```

**关键区别**：
- `snapshot -i`（交互投影）：`[web]` 节点只显示可见文字片段，不含 URL
- `snapshot`（完整树）：`[web]` 节点携带完整 URL

### 步骤2：用 webReader 抓取 URL 全文

```bash
# 使用 webReader MCP 工具
webReader(url="https://www.xiaohongshu.com/crown/community/privacy_intl?...")
```

返回完整页面 Markdown 文本，包含所有章节内容。

## 适用场景

| 场景 | 说明 |
|------|------|
| 191号文检测 | 隐私政策全文提取，替代 scroll+screenshot 方式 |
| 任何 Web 页面 | 只要 `[web]` 节点有 URL 就能用 |
| 内容比对 | 拿到全文后可直接做关键词匹配 |

## 局限性

1. **URL 需要可公网访问**：如果 Web 组件使用的是内网地址或需要登录态，webReader 可能无法访问
2. **动态内容**：部分页面内容通过 JS 动态加载，webReader 可能拿不到完整内容
3. **`[web]` 节点不一定都有 URL**：取决于应用实现

## 与 scroll+screenshot 对比

| 方式 | 优点 | 缺点 |
|------|------|------|
| scroll + screenshot | 100% 还原用户视角 | 慢（13屏需要 26+ 条命令）、可能有滚动遗漏 |
| snapshot URL + webReader | 快（2步完成）、完整文本 | 依赖 URL 可访问、非视觉证据 |

**建议**：191号文检测时两种方式结合——先用 URL 拿全文做内容检查，再用 scroll+screenshot 做视觉证据。

## 实操案例：小红书隐私政策

1. 在"关于小红书"页面点击"隐私政策"，进入 Web 页面
2. `snapshot`（不带 `-i`）找到 `[web]` 节点 URL：
   `https://www.xiaohongshu.com/crown/community/privacy_intl?tab=0&sid=session.1779964628424215749571&themeType=dark`
3. webReader 抓取全文，包含完整 11 章节隐私政策内容
4. 直接检查 7 大核心内容：信息收集、信息使用、信息共享、信息保护、用户权利、政策更新、投诉渠道
