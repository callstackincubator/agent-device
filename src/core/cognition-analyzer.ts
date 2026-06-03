/**
 * 认知地图核心逻辑
 * 分析UI结构，生成AI可读的认知地图
 */

export type CognitionMap = {
  overview: {
    platform: string;
    screenResolution: { width: number; height: number };
    totalNodes: number;
    treeDepth: number;
    complexity: 'simple' | 'medium' | 'complex';
  };
  structure: {
    layoutPattern: string[];
    mainContainers: number;
  };
  interactions: {
    clickableElements: number;
    buttons: number;
    inputFields: number;
    tabs: number;
  };
  features: {
    hasScroll: boolean;
    hasTabs: boolean;
    hasModal: boolean;
    hasList: boolean;
    hasForm: boolean;
    hasUnlabeledIcons: boolean;
  };
  suggestions: string[];
  testPriority: 'high' | 'medium' | 'low';
};

export function analyzeSnapshotForCognition(
  nodes: Array<{
    type?: string;
    depth?: number;
    hittable?: boolean;
    rect?: { x: number; y: number; width: number; height: number };
    label?: string;
    value?: string;
  }>,
  platform: string,
): CognitionMap {
  // 计算基础统计
  const totalNodes = nodes.length;
  const depths = nodes.map((n) => n.depth ?? 0);
  const maxDepth = Math.max(...depths, 0);
  const avgDepth =
    depths.length > 0 ? Math.round(depths.reduce((a, b) => a + b, 0) / depths.length) : 0;

  // 计算复杂度
  const complexityScore = (totalNodes * avgDepth) / 100;
  const complexity: 'simple' | 'medium' | 'complex' =
    complexityScore < 50 ? 'simple' : complexityScore < 100 ? 'medium' : 'complex';

  // 分析节点类型
  const nodeTypes = nodes.map((n) => n.type ?? '').filter((t) => t);
  const uniqueTypes = [...new Set(nodeTypes)];

  // 分析交互元素
  const clickableElements = nodes.filter((n) => n.hittable).length;
  // 按钮包括显式button类型和无label的可点击图标(Image类型且hittable)
  const buttons = nodes.filter((n) => {
    const type = (n.type ?? '').toLowerCase();
    if (type.includes('button')) return true;
    // 无label的可点击Image可能是图标按钮(如设置齿轮)
    if (type === 'image' && n.hittable && !n.label) return true;
    return false;
  }).length;
  const inputFields = nodes.filter((n) =>
    (n.type ?? '').toLowerCase().match(/input|textfield|edittext/),
  ).length;
  const tabs = nodes.filter((n) => (n.type ?? '').toLowerCase().includes('tab')).length;

  // 检测无label的可点击图标元素(如设置齿轮图标)
  const unlabeledClickables = nodes.filter(
    (n) => n.hittable && !n.label && (n.type ?? '').toLowerCase() === 'image',
  );
  const hasUnlabeledIcons = unlabeledClickables.length > 0;

  // 分析界面特征
  const hasScroll = uniqueTypes.some((t) => t.toLowerCase().match(/scroll|list|swiper/));
  const hasTabs = tabs > 0 || uniqueTypes.some((t) => t.toLowerCase().includes('navigation'));
  const hasModal = uniqueTypes.some((t) => t.toLowerCase().match(/dialog|modal|popup|alert/));
  const hasList =
    uniqueTypes.some((t) => t.toLowerCase().includes('list')) ||
    nodeTypes.filter((t) => t.toLowerCase() === 'column').length > 5;
  const hasForm = inputFields > 0;

  // 确定布局模式
  const layoutPattern: string[] = [];
  if (uniqueTypes.some((t) => t.toLowerCase().includes('navigation')))
    layoutPattern.push('navigation-based');
  if (nodeTypes.filter((t) => t.toLowerCase() === 'row').length > 10)
    layoutPattern.push('horizontal-layout');
  if (nodeTypes.filter((t) => t.toLowerCase() === 'column').length > 10)
    layoutPattern.push('vertical-layout');
  if (uniqueTypes.some((t) => t.toLowerCase().includes('list'))) layoutPattern.push('list-view');
  if (layoutPattern.length === 0) layoutPattern.push('unknown');

  // 生成建议
  const suggestions: string[] = [];
  if (complexity === 'complex') suggestions.push('界面复杂度高，建议放慢测试速度');
  if (clickableElements > 10) suggestions.push('交互元素多，建议分类测试');
  if (hasTabs) suggestions.push('存在Tab导航，建议逐个Tab遍历');
  if (hasForm) suggestions.push('存在表单，建议重点测试输入验证');
  if (hasScroll) suggestions.push('存在滚动区域，建议测试滚动交互');
  if (hasUnlabeledIcons)
    suggestions.push(
      `存在${unlabeledClickables.length}个无标签图标(如设置齿轮),建议通过坐标或raw snapshot定位`,
    );

  // 确定测试优先级
  let testPriority: 'high' | 'medium' | 'low' = 'low';
  if (hasForm || clickableElements > 15) testPriority = 'high';
  else if (hasTabs || complexity === 'complex') testPriority = 'medium';

  // 获取屏幕分辨率
  const rootNode = nodes.find((n) => n.depth === 0);
  const screenResolution = rootNode?.rect ?? { width: 1260, height: 2720 };

  return {
    overview: {
      platform,
      screenResolution,
      totalNodes,
      treeDepth: maxDepth,
      complexity,
    },
    structure: {
      layoutPattern,
      mainContainers: nodes.filter(
        (n) => (n.depth ?? 0) < 5 && (n.type ?? '').match(/Stack|Column|Row|Navigation/),
      ).length,
    },
    interactions: {
      clickableElements,
      buttons,
      inputFields,
      tabs,
    },
    features: {
      hasScroll,
      hasTabs,
      hasModal,
      hasList,
      hasForm,
      hasUnlabeledIcons,
    },
    suggestions,
    testPriority,
  };
}

export function formatCognitionMapForLLM(map: CognitionMap): string {
  return `
# UI认知地图

## 概览
- 平台: ${map.overview.platform}
- 屏幕分辨率: ${map.overview.screenResolution.width}x${map.overview.screenResolution.height}
- UI节点总数: ${map.overview.totalNodes}
- 树深度: ${map.overview.treeDepth}层
- 界面复杂度: ${map.overview.complexity}

## UI结构
- 布局模式: ${map.structure.layoutPattern.join(', ')}
- 主容器数量: ${map.structure.mainContainers}

## 交互元素
- 可点击元素: ${map.interactions.clickableElements}个
- 按钮: ${map.interactions.buttons}个
- 输入框: ${map.interactions.inputFields}个
- Tab导航: ${map.interactions.tabs}个

## 界面特征
- 可滚动: ${map.features.hasScroll ? '是' : '否'}
- 有Tab导航: ${map.features.hasTabs ? '是' : '否'}
- 有弹窗: ${map.features.hasModal ? '是' : '否'}
- 有列表: ${map.features.hasList ? '是' : '否'}
- 有表单: ${map.features.hasForm ? '是' : '否'}
- 有无标签图标: ${map.features.hasUnlabeledIcons ? '是(需通过坐标定位)' : '否'}

## 测试优先级
- **${map.testPriority === 'high' ? '高优先级' : map.testPriority === 'medium' ? '中等优先级' : '低优先级'}**

## 测试建议
${map.suggestions.length > 0 ? map.suggestions.map((s) => `- ${s}`).join('\n') : '- 界面简单，可以快速遍历'}

## 大模型使用建议
基于以上认知地图，建议：
1. 先识别${map.interactions.clickableElements}个可点击元素的位置
2. ${map.features.hasTabs ? '逐个Tab切换测试' : '按交互顺序测试'}
3. ${map.features.hasForm ? '重点验证表单输入和提交' : '验证导航跳转逻辑'}
4. 预估测试时间: ${Math.round((map.interactions.clickableElements * 2) / 60)}分钟
`;
}
