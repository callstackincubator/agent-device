#!/usr/bin/env node
/**
 * 应用认知地图生成器
 * 为大模型提供应用的UI结构概览，避免盲目测试
 */

import fs from 'fs';
import path from 'path';

function buildAppCognitionMap(layoutJson) {
  const rawData = JSON.parse(fs.readFileSync(layoutJson, 'utf8'));

  // 分析UI结构
  const analysis = analyzeUI(rawData);

  // 生成认知地图（给大模型看的）
  const cognitionMap = {
    // 基本信息
    overview: {
      screenResolution: getScreenResolution(rawData),
      totalNodes: analysis.totalNodes,
      treeDepth: analysis.maxDepth,
      complexity: calculateComplexity(analysis),
    },

    // UI结构概览
    structure: {
      layoutPattern: identifyLayoutPattern(analysis.nodeTypes),
      mainContainers: findMainContainers(rawData),
      navigationElements: findNavigationElements(rawData),
    },

    // 交互元素分析
    interactions: {
      clickableElements: extractClickableElements(rawData),
      inputFields: extractInputFields(rawData),
      buttons: extractButtons(rawData),
      tabs: extractTabs(rawData),
    },

    // 界面特征
    features: {
      hasScroll: detectScroll(rawData),
      hasTabs: analysis.nodeTypes.Tab > 0 || analysis.nodeTypes.Navigation > 0,
      hasModal: detectModal(rawData),
      hasList: analysis.nodeTypes.List > 0 || analysis.nodeTypes.Column > 5,
      hasForm: analysis.nodeTypes.TextField > 0 || analysis.nodeTypes.TextInput > 0,
    },

    // 大模型建议
    suggestions: generateSuggestions(analysis),

    // 原始数据摘要
    rawSummary: {
      nodeTypeDistribution: Object.entries(analysis.nodeTypes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15),
      depthDistribution: analysis.depthDistribution,
    }
  };

  return cognitionMap;
}

function analyzeUI(node) {
  const stats = {
    totalNodes: 0,
    maxDepth: 0,
    nodeTypes: {},
    depthDistribution: {},
    interactiveNodes: [],
  };

  function traverse(n, depth) {
    if (!n) return;

    stats.totalNodes++;
    stats.maxDepth = Math.max(stats.maxDepth, depth);
    stats.depthDistribution[depth] = (stats.depthDistribution[depth] || 0) + 1;

    const type = n.attributes?.type || 'unknown';
    stats.nodeTypes[type] = (stats.nodeTypes[type] || 0) + 1;

    if (n.attributes?.clickable === 'true' || n.attributes?.hittable) {
      stats.interactiveNodes.push({
        type,
        depth,
        label: n.attributes?.text || n.attributes?.description || '',
        bounds: n.attributes?.bounds,
      });
    }

    if (n.children) {
      n.children.forEach(child => traverse(child, depth + 1));
    }
  }

  traverse(node, 0);
  return stats;
}

function getScreenResolution(node) {
  const bounds = node.attributes?.bounds || '';
  const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (match) {
    return { width: parseInt(match[3]), height: parseInt(match[4]) };
  }
  return { width: 1260, height: 2720 }; // 默认
}

function calculateComplexity(analysis) {
  // 复杂度评分：节点数 * 平均深度 / 100
  const avgDepth = Object.entries(analysis.depthDistribution)
    .reduce((sum, [d, count]) => sum + parseInt(d) * count, 0) / analysis.totalNodes;

  const score = Math.round(analysis.totalNodes * avgDepth / 100);

  if (score < 50) return 'simple';
  if (score < 100) return 'medium';
  return 'complex';
}

function identifyLayoutPattern(nodeTypes) {
  const patterns = [];

  if (nodeTypes.Navigation > 0) patterns.push('navigation-based');
  if (nodeTypes.Tab > 0 || nodeTypes['TabContent'] > 0) patterns.push('tab-based');
  if (nodeTypes.Column > 10) patterns.push('vertical-scroll');
  if (nodeTypes.Row > 10) patterns.push('horizontal-layout');
  if (nodeTypes.List > 0) patterns.push('list-view');
  if (nodeTypes.Grid > 0) patterns.push('grid-view');

  return patterns.length > 0 ? patterns : ['unknown'];
}

function findMainContainers(node) {
  const containers = [];

  function find(n, depth) {
    if (!n) return;

    const type = n.attributes?.type || '';
    const bounds = n.attributes?.bounds || '';

    // 主容器特征：深度浅、面积大
    if (depth < 5 && type.match(/Stack|Column|Row|Navigation|NavDestination/)) {
      const size = parseBoundsSize(bounds);
      if (size > 500000) { // 面积大于500k像素
        containers.push({
          type,
          depth,
          bounds,
          area: size,
        });
      }
    }

    if (n.children) {
      n.children.forEach(child => find(child, depth + 1));
    }
  }

  find(node, 0);
  return containers.slice(0, 5);
}

function parseBoundsSize(bounds) {
  const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (match) {
    const w = parseInt(match[3]) - parseInt(match[1]);
    const h = parseInt(match[4]) - parseInt(match[2]);
    return w * h;
  }
  return 0;
}

function findNavigationElements(node) {
  const navElements = [];

  function find(n) {
    if (!n) return;

    const type = n.attributes?.type || '';
    const text = n.attributes?.text || '';

    // 导航元素特征
    if (type.match(/Button|Tab|Navigation/) ||
        text.match(/首页|返回|关闭|取消|确定|更多|设置|搜索|登录|注册/)) {
      navElements.push({
        type,
        label: text || n.attributes?.description || '',
        bounds: n.attributes?.bounds,
      });
    }

    if (n.children) {
      n.children.forEach(find);
    }
  }

  find(node);
  return navElements.slice(0, 20);
}

function extractClickableElements(node) {
  return extractElementsByAttribute(node, 'clickable', 'true', 30);
}

function extractInputFields(node) {
  return extractElementsByType(node, /TextInput|TextField|EditText|Search/, 10);
}

function extractButtons(node) {
  return extractElementsByType(node, /Button/, 30);
}

function extractTabs(node) {
  return extractElementsByType(node, /Tab|TabContent/, 10);
}

function extractElementsByAttribute(node, attr, value, limit) {
  const elements = [];

  function extract(n) {
    if (!n) return;

    if (n.attributes?.[attr] === value) {
      elements.push({
        type: n.attributes?.type || 'unknown',
        label: n.attributes?.text || n.attributes?.description || '',
        bounds: n.attributes?.bounds,
      });
    }

    if (n.children) {
      n.children.forEach(extract);
    }
  }

  extract(node);
  return elements.slice(0, limit);
}

function extractElementsByType(node, typePattern, limit) {
  const elements = [];

  function extract(n) {
    if (!n) return;

    const type = n.attributes?.type || '';
    if (typePattern.test(type)) {
      elements.push({
        type,
        label: n.attributes?.text || n.attributes?.description || '',
        bounds: n.attributes?.bounds,
      });
    }

    if (n.children) {
      n.children.forEach(extract);
    }
  }

  extract(node);
  return elements.slice(0, limit);
}

function detectScroll(node) {
  function check(n) {
    if (!n) return false;
    const type = n.attributes?.type || '';
    if (type.match(/Scroll|List|Swiper/)) return true;
    if (n.children) {
      return n.children.some(check);
    }
    return false;
  }
  return check(node);
}

function detectModal(node) {
  function check(n) {
    if (!n) return false;
    const type = n.attributes?.type || '';
    if (type.match(/Dialog|Modal|Popup|Alert/)) return true;
    if (n.children) {
      return n.children.some(check);
    }
    return false;
  }
  return check(node);
}

function generateSuggestions(analysis) {
  const suggestions = [];

  // 根据复杂度给出建议
  if (analysis.totalNodes > 200) {
    suggestions.push('界面复杂度高，建议优先测试关键路径');
  }

  if (analysis.nodeTypes.Button > 10) {
    suggestions.push('存在多个按钮，建议先识别主要功能按钮');
  }

  if (analysis.nodeTypes.Navigation > 0) {
    suggestions.push('存在导航结构，建议按导航层级遍历');
  }

  if (analysis.nodeTypes.Tab > 0) {
    suggestions.push('存在Tab导航，建议逐个Tab遍历');
  }

  if (analysis.interactiveNodes.length > 20) {
    suggestions.push('交互元素多，建议分类测试（按钮、输入框、链接等）');
  }

  return suggestions;
}

// 生成大模型可读的文本报告
function generateLLMReadableReport(cognitionMap) {
  return `
# 应用UI认知地图

## 概览
- 屏幕分辨率: ${cognitionMap.overview.screenResolution.width}x${cognitionMap.overview.screenResolution.height}
- UI节点总数: ${cognitionMap.overview.totalNodes}
- 树深度: ${cognitionMap.overview.treeDepth}层
- 界面复杂度: ${cognitionMap.overview.complexity}

## UI结构
- 布局模式: ${cognitionMap.structure.layoutPattern.join(', ')}
- 主容器数量: ${cognitionMap.structure.mainContainers.length}

## 交互元素
- 可点击元素: ${cognitionMap.interactions.clickableElements.length}个
- 输入框: ${cognitionMap.interactions.inputFields.length}个
- 按钮: ${cognitionMap.interactions.buttons.length}个
- Tab导航: ${cognitionMap.interactions.tabs.length}个

## 界面特征
- 可滚动: ${cognitionMap.features.hasScroll ? '是' : '否'}
- 有Tab导航: ${cognitionMap.features.hasTabs ? '是' : '否'}
- 有弹窗: ${cognitionMap.features.hasModal ? '是' : '否'}
- 有列表: ${cognitionMap.features.hasList ? '是' : '否'}
- 有表单: ${cognitionMap.features.hasForm ? '是' : '否'}

## 测试建议
${cognitionMap.suggestions.map(s => `- ${s}`).join('\n')}

## 节点类型分布 (Top 10)
${cognitionMap.rawSummary.nodeTypeDistribution.slice(0, 10).map(([type, count]) => `- ${type}: ${count}个`).join('\n')}

## 主要交互元素示例
${cognitionMap.interactions.clickableElements.slice(0, 10).map(e => `- ${e.type}: "${e.label}"`).join('\n')}
`;
}

// 执行
const inputFile = process.argv[2] || './traverse-output/raw-layout.json';
const outputDir = process.argv[3] || './traverse-output';

if (fs.existsSync(inputFile)) {
  const cognitionMap = buildAppCognitionMap(inputFile);

  // 保存JSON格式
  fs.writeFileSync(
    path.join(outputDir, 'cognition-map.json'),
    JSON.stringify(cognitionMap, null, 2)
  );

  // 生成大模型可读的文本报告
  const llmReport = generateLLMReadableReport(cognitionMap);
  fs.writeFileSync(
    path.join(outputDir, 'cognition-map.md'),
    llmReport
  );

  console.log(llmReport);
  console.log('\n报告已保存:');
  console.log(`  JSON: ${outputDir}/cognition-map.json`);
  console.log(`  文本: ${outputDir}/cognition-map.md`);
} else {
  console.log('使用方法:');
  console.log('  node scripts/build-cognition-map.js <layout.json> <output-dir>');
}