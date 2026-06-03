---
name: harmonyos-traverse-report
description: 鸿蒙遍历报告生成。生成 Markdown 和 JSON 格式的遍历报告，包含基本信息、遍历结果、首启弹窗链、未覆盖区域、覆盖率统计。触发词：鸿蒙遍历报告、harmonyos traverse report。
---

# 鸿蒙遍历报告生成

汇总遍历数据，生成结构化报告。

## 输出目录结构

```
harmonyos-lab/reports/traverse-<bundleId>-<日期>/
├── screens/                    # 截图
│   ├── launch_1.png           # 首启弹窗
│   ├── s1_d0.png              # 第1屏 depth=0
│   ├── s2_d1.png              # 第2屏 depth=1
│   └── ...
├── traverse-report.md          # 遍历报告
└── traverse-report.json        # 结构化数据
```

## 报告内容（Markdown）

```markdown
# <AppName> 遍历报告

## 基本信息
- Bundle ID:
- 版本:
- 设备:
- 遍历时间:
- 总屏幕数:
- 总点击数:

## 遍历结果
| 屏幕ID | 深度 | 父动作 | 截图 | 发现的交互 |
|--------|------|--------|------|-----------|

## 遍历路径
按深度和点击顺序展示遍历路径（树状结构）。

## 首启弹窗链
1. 隐私政策弹窗 → 点"同意"
2. 通知权限 → 点"不允许"
3. 广告弹窗 → 点"跳过"

## 未覆盖区域
- 登录墙：xxx 页面（需要登录）
- H5 页面：xxx 页面
- 崩溃：xxx 操作导致崩溃

## 遍历覆盖率
- 可达屏幕数 / 总屏幕数
- 未登录可达 / 需登录才能到达

## 遍历截图
按屏幕 ID 展示截图缩略图（使用相对路径）。
```

## 结构化数据（JSON）

```json
{
  "bundleId": "com.example.app",
  "device": "HDC-serial",
  "startTime": "2026-05-29T10:00:00Z",
  "endTime": "2026-05-29T10:30:00Z",
  "screensVisited": 25,
  "clicksTotal": 45,
  "maxDepthReached": 3,
  "dialogs": [
    { "type": "privacy", "action": "agree" },
    { "type": "notification", "action": "disallow" }
  ],
  "screens": [
    {
      "id": 1,
      "depth": 0,
      "fingerprint": "156-tabs-home-discover-mine",
      "screenshot": "screens/s1_d0.png",
      "parentAction": null,
      "interactions": ["tab:首页", "tab:发现", "tab:我的", "button:设置"]
    }
  ],
  "loginWalls": [
    { "screenId": 5, "feature": "个人中心" }
  ],
  "h5Pages": [
    { "screenId": 12, "url": "https://..." }
  ],
  "coverage": {
    "reachableScreens": 25,
    "loginRequiredScreens": 3,
    "h5Screens": 2
  }
}
```

## 生成步骤

1. 汇总各阶段输出的状态数据
2. 写入 `traverse-report.json`
3. 根据模板生成 `traverse-report.md`
4. 截图相对路径正确引用

## 完成标记

报告生成后，向用户提示：
- 报告路径
- 截图数量
- 遍历覆盖率摘要