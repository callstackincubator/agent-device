# HarmonyOS 应用智能遍历方案

## 目标
为大模型提供应用的"认知地图"，避免盲目点击测试

## 工作流程

### 第一步：静态分析生成认知地图
```bash
# 1. 导出UI布局
hdc shell "uitest dumpLayout -p /data/local/tmp/layout.json"
hdc file recv /data/local/tmp/layout.json ./layout.json

# 2. 生成认知地图
node scripts/build-cognition-map.js ./layout.json ./output
```

### 第二步：认知地图示例输出
```
# 应用UI认知地图

## 概览
- 屏幕分辨率: 1260x2720
- UI节点总数: 109
- 树深度: 15层
- 界面复杂度: simple

## UI结构
- 布局模式: navigation-based, horizontal-layout
- 主容器数量: 4

## 交互元素
- 可点击元素: 9个
- 输入框: 0个
- 按钮: 2个
- Tab导航: 0个

## 界面特征
- 可滚动: 是
- 有Tab导航: 是
- 有弹窗: 否
- 有列表: 是
- 有表单: 否

## 测试建议
- 存在导航结构，建议按导航层级遍历
```

### 第三步：大模型基于认知地图制定测试计划

大模型会收到认知地图，然后生成测试计划：

**示例计划（JSON格式）**：
```json
{
  "testPlan": {
    "priority": "high",
    "strategy": "navigation-first",
    "steps": [
      {
        "step": 1,
        "action": "check_initial_state",
        "target": "root",
        "reason": "认知地图显示存在导航结构，先确认初始界面"
      },
      {
        "step": 2,
        "action": "identify_navigation",
        "target": "tabs_and_buttons",
        "reason": "发现9个可点击元素，2个按钮，先识别导航入口"
      },
      {
        "step": 3,
        "action": "click_primary_button",
        "target": "Button[type=primary]",
        "reason": "界面复杂度simple，优先测试主要功能按钮"
      },
      {
        "step": 4,
        "action": "verify_navigation",
        "target": "new_screen",
        "reason": "验证导航跳转是否成功"
      },
      {
        "step": 5,
        "action": "scroll_test",
        "target": "scrollable_area",
        "reason": "认知地图显示可滚动区域，测试滚动功能"
      }
    ]
  }
}
```

### 第四步：执行智能遍历

基于大模型的测试计划，执行实际测试：

```bash
# 执行第1步：确认初始界面
node dist/src/cli.js snapshot --session xxx --json

# 执行第2步：识别导航
node dist/src/cli.js snapshot -i --session xxx

# 执行第3步：点击主要按钮
node dist/src/cli.js press @e20 --session xxx

# 执行第4步：验证跳转
node dist/src/cli.js snapshot --session xxx --json

# 执行第5步：测试滚动
node dist/src/cli.js scroll down 0.5 --session xxx
```

## 优势对比

### 传统盲目测试 vs 认知地图引导测试

| 特性 | 盲目测试 | 认知地图引导 |
|-----|---------|------------|
| **效率** | 低（随机点击） | 高（有目标） |
| **覆盖率** | 难保证 | 可规划 |
| **测试深度** | 表层 | 可深入关键路径 |
| **大模型负担** | 重（需要实时分析） | 轻（已有认知基础） |
| **可复用性** | 低 | 高（认知地图可复用） |

## 实际收益

### 认知地图提供的信息
1. **UI结构**：节点数、深度、布局模式
2. **交互元素**：按钮、输入框、Tab等数量和位置
3. **界面特征**：是否可滚动、有弹窗、有列表等
4. **测试建议**：基于复杂度的智能建议

### 大模型使用方式
大模型收到认知地图后：
1. 不需要每次都分析完整UI树
2. 可以制定有策略的测试计划
3. 可以优先测试关键功能
4. 可以避免无效的点击操作
5. 可以更准确地预测测试结果

## 扩展应用

### 多界面认知地图
可以导出多个界面的布局，生成完整的应用地图：

```bash
# 主界面
hdc shell "uitest dumpLayout -p /data/local/tmp/home.json"

# 详情界面（需要先导航进入）
hdc shell "uitest dumpLayout -p /data/local/tmp/detail.json"

# 设置界面
hdc shell "uitest dumpLayout -p /data/local/tmp/settings.json"

# 生成完整应用地图
node scripts/merge-cognition-maps.js ./maps/*.json ./app-map.json
```

### 认知地图应用场景
1. **自动化测试规划**：大模型基于地图制定测试策略
2. **回归测试**：对比新旧版本的认知地图变化
3. **UI一致性检查**：检查UI是否符合设计规范
4. **性能优化**：识别复杂UI结构，优化渲染性能
5. **无障碍测试**：识别缺少标签的交互元素