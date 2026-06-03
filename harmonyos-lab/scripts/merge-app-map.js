#!/usr/bin/env node
/**
 * 应用地图合并器
 * 合并多个界面的认知地图，生成完整的应用结构图
 */

import fs from 'fs';
import path from 'path';

function loadCognitionMaps(mapFiles) {
  return mapFiles.map(file => {
    const jsonPath = file.replace('.md', '.json');
    if (fs.existsSync(jsonPath)) {
      return {
        file,
        data: JSON.parse(fs.readFileSync(jsonPath, 'utf8')),
      };
    }
    return null;
  }).filter(m => m !== null);
}

function mergeAppMaps(maps) {
  const appMap = {
    // 应用基本信息
    appInfo: {
      platform: 'harmonyos',
      totalScreens: maps.length,
      analyzedAt: new Date().toISOString(),
    },

    // 界面汇总
    screensSummary: {
      totalNodes: 0,
      avgNodes: 0,
      maxNodes: 0,
      minNodes: 0,
      maxDepth: 0,
      avgDepth: 0,
      totalInteractive: 0,
      avgInteractive: 0,
    },

    // 各界面详情
    screens: maps.map((m, index) => ({
      id: index + 1,
      name: path.basename(m.file).replace(/\.json$|\.md$/, ''),
      ...m.data.overview,
      interactions: {
        clickable: m.data.interactions.clickableElements?.length || 0,
        buttons: m.data.interactions.buttons?.length || 0,
        inputFields: m.data.interactions.inputFields?.length || 0,
      },
      features: m.data.features,
      suggestions: m.data.suggestions,
    })),

    // 界面类型分布
    screenTypes: analyzeScreenTypes(maps),

    // 交互元素汇总
    interactionSummary: analyzeInteractions(maps),

    // UI结构模式汇总
    structurePatterns: analyzeStructurePatterns(maps),

    // 节点类型分布（所有界面）
    nodeTypeDistribution: mergeNodeTypeDistribution(maps),

    // 界面关系分析
    screenRelationships: analyzeScreenRelationships(maps),

    // 测试建议（全局）
    globalSuggestions: generateGlobalSuggestions(maps),

    // 测试优先级排序
    testPriority: prioritizeScreens(maps),
  };

  // 计算汇总数据
  const nodesList = maps.map(m => m.data.overview.totalNodes);
  const depthList = maps.map(m => m.data.overview.treeDepth);
  const interactiveList = maps.map(m => m.data.interactions.clickableElements?.length || 0);

  appMap.screensSummary.totalNodes = nodesList.reduce((a, b) => a + b, 0);
  appMap.screensSummary.avgNodes = Math.round(appMap.screensSummary.totalNodes / maps.length);
  appMap.screensSummary.maxNodes = Math.max(...nodesList);
  appMap.screensSummary.minNodes = Math.min(...nodesList);
  appMap.screensSummary.maxDepth = Math.max(...depthList);
  appMap.screensSummary.avgDepth = Math.round(depthList.reduce((a, b) => a + b, 0) / maps.length);
  appMap.screensSummary.totalInteractive = interactiveList.reduce((a, b) => a + b, 0);
  appMap.screensSummary.avgInteractive = Math.round(appMap.screensSummary.totalInteractive / maps.length);

  return appMap;
}

function analyzeScreenTypes(maps) {
  const types = {};

  maps.forEach(m => {
    const features = m.data.features || {};
    const patterns = m.data.structure?.layoutPattern || [];

    // 分类界面类型
    if (features.hasModal) types.modal = (types.modal || 0) + 1;
    if (features.hasForm) types.form = (types.form || 0) + 1;
    if (features.hasList) types.list = (types.list || 0) + 1;
    if (features.hasTabs) types.tabbed = (types.tabbed || 0) + 1;
    if (patterns.includes('navigation-based')) types.navigation = (types.navigation || 0) + 1;

    if (Object.keys(features).filter(k => features[k]).length === 0) {
      types.simple = (types.simple || 0) + 1;
    }
  });

  return types;
}

function analyzeInteractions(maps) {
  const summary = {
    totalClickable: 0,
    totalButtons: 0,
    totalInputs: 0,
    totalTabs: 0,
    interactiveScreens: [],
    lowInteractiveScreens: [],
  };

  maps.forEach((m, index) => {
    const clickable = m.data.interactions.clickableElements?.length || 0;
    const buttons = m.data.interactions.buttons?.length || 0;
    const inputs = m.data.interactions.inputFields?.length || 0;
    const tabs = m.data.interactions.tabs?.length || 0;

    summary.totalClickable += clickable;
    summary.totalButtons += buttons;
    summary.totalInputs += inputs;
    summary.totalTabs += tabs;

    if (clickable > 10) {
      summary.interactiveScreens.push({
        screen: index + 1,
        clickable,
        reason: '高交互密度',
      });
    } else if (clickable < 3) {
      summary.lowInteractiveScreens.push({
        screen: index + 1,
        clickable,
        reason: '低交互密度',
      });
    }
  });

  return summary;
}

function analyzeStructurePatterns(maps) {
  const patterns = {};

  maps.forEach(m => {
    const layoutPatterns = m.data.structure?.layoutPattern || [];
    layoutPatterns.forEach(p => {
      patterns[p] = (patterns[p] || 0) + 1;
    });
  });

  return Object.entries(patterns)
    .sort((a, b) => b[1] - a[1])
    .map(([pattern, count]) => ({ pattern, count }));
}

function mergeNodeTypeDistribution(maps) {
  const distribution = {};

  maps.forEach(m => {
    const types = m.data.rawSummary?.nodeTypeDistribution || [];
    types.forEach(([type, count]) => {
      distribution[type] = (distribution[type] || 0) + count;
    });
  });

  return Object.entries(distribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([type, count]) => ({ type, count }));
}

function analyzeScreenRelationships(maps) {
  // 基于复杂度和交互密度推断可能的界面关系
  const relationships = [];

  maps.forEach((m, index) => {
    const overview = m.data.overview;
    const features = m.data.features;

    // 复杂度低的界面可能是入口
    if (overview.complexity === 'simple' && !features.hasModal) {
      relationships.push({
        screen: index + 1,
        role: 'entry_candidate',
        reason: '复杂度低，可能是入口界面',
      });
    }

    // 有导航的界面可能是中间层
    if (features.hasTabs || features.hasScroll) {
      relationships.push({
        screen: index + 1,
        role: 'content_container',
        reason: '有导航/滚动，可能是内容容器',
      });
    }

    // 有弹窗的界面可能是详情或确认
    if (features.hasModal) {
      relationships.push({
        screen: index + 1,
        role: 'detail_or_confirm',
        reason: '有弹窗，可能是详情或确认界面',
      });
    }

    // 有表单的界面可能是输入类
    if (features.hasForm) {
      relationships.push({
        screen: index + 1,
        role: 'input_screen',
        reason: '有表单，可能是输入界面',
      });
    }
  });

  return relationships;
}

function generateGlobalSuggestions(maps) {
  const suggestions = [];

  // 基于界面数量
  if (maps.length > 10) {
    suggestions.push({
      priority: 'high',
      suggestion: '应用界面较多，建议分批次测试，优先测试核心功能界面',
    });
  }

  // 基于交互密度差异
  const interactiveVar = analyzeInteractions(maps);
  if (interactiveVar.interactiveScreens.length > 0) {
    suggestions.push({
      priority: 'high',
      suggestion: `存在${interactiveVar.interactiveScreens.length}个高交互界面，需要重点测试交互逻辑`,
    });
  }

  // 基于复杂度分布
  const complexScreens = maps.filter(m => m.data.overview.complexity === 'complex');
  if (complexScreens.length > 0) {
    suggestions.push({
      priority: 'medium',
      suggestion: `有${complexScreens.length}个复杂界面，建议放慢测试速度，深入验证`,
    });
  }

  // 基于界面类型
  const types = analyzeScreenTypes(maps);
  if (types.form > 0) {
    suggestions.push({
      priority: 'high',
      suggestion: `存在${types.form}个表单界面，建议重点测试输入验证和提交逻辑`,
    });
  }
  if (types.modal > 0) {
    suggestions.push({
      priority: 'medium',
      suggestion: `存在${types.modal}个弹窗界面，建议测试弹窗显示和关闭逻辑`,
    });
  }

  // 基于导航结构
  const navScreens = maps.filter(m =>
    m.data.structure?.layoutPattern?.includes('navigation-based')
  );
  if (navScreens.length > 0) {
    suggestions.push({
      priority: 'high',
      suggestion: `有${navScreens.length}个界面使用导航结构，建议按导航层级遍历`,
    });
  }

  return suggestions;
}

function prioritizeScreens(maps) {
  // 根据多个因素计算测试优先级
  return maps.map((m, index) => {
    let score = 0;
    const reasons = [];

    // 交互元素多 → 高优先级
    const clickable = m.data.interactions.clickableElements?.length || 0;
    if (clickable > 10) {
      score += 30;
      reasons.push('高交互密度');
    }

    // 有表单 → 高优先级
    if (m.data.features.hasForm) {
      score += 25;
      reasons.push('有表单输入');
    }

    // 复杂度高 → 高优先级
    if (m.data.overview.complexity === 'complex') {
      score += 20;
      reasons.push('复杂度高');
    }

    // 是入口候选 → 高优先级
    if (m.data.overview.complexity === 'simple' && !m.data.features.hasModal) {
      score += 15;
      reasons.push('可能是入口界面');
    }

    // 有导航 → 中等优先级
    if (m.data.features.hasTabs || m.data.features.hasScroll) {
      score += 10;
      reasons.push('有导航元素');
    }

    return {
      screen: index + 1,
      name: path.basename(maps[index].file).replace(/\.json$|\.md$/, ''),
      score,
      priority: score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low',
      reasons,
    };
  }).sort((a, b) => b.score - a.score);
}

// 生成大模型可读的应用地图文本
function generateLLMReadableAppMap(appMap) {
  return `
# 应用完整认知地图

## 应用概览
- 平台: ${appMap.appInfo.platform}
- 已分析界面数: ${appMap.appInfo.totalScreens}
- 分析时间: ${appMap.appInfo.analyzedAt}

## 界面汇总
- 总节点数: ${appMap.screensSummary.totalNodes}
- 平均节点数: ${appMap.screensSummary.avgNodes}
- 最大节点数: ${appMap.screensSummary.maxNodes}
- 最小节点数: ${appMap.screensSummary.minNodes}
- 平均UI深度: ${appMap.screensSummary.avgDepth}层
- 最大UI深度: ${appMap.screensSummary.maxDepth}层
- 总交互元素: ${appMap.screensSummary.totalInteractive}个
- 平均交互元素: ${appMap.screensSummary.avgInteractive}个

## 界面类型分布
${Object.entries(appMap.screenTypes).map(([type, count]) => `- ${type}: ${count}个界面`).join('\n')}

## 界面详情列表
${appMap.screens.map(s => `
### 界面 ${s.id}: ${s.name}
- 节点数: ${s.totalNodes}
- UI深度: ${s.treeDepth}层
- 复杂度: ${s.complexity}
- 可点击元素: ${s.interactions.clickable}个
- 按钮: ${s.interactions.buttons}个
- 输入框: ${s.interactions.inputFields}个
- 特征: 可滚动=${s.features.hasScroll ? '是' : '否'}, Tab=${s.features.hasTabs ? '是' : '否'}, 弹窗=${s.features.hasModal ? '是' : '否'}, 列表=${s.features.hasList ? '是' : '否'}, 表单=${s.features.hasForm ? '是' : '否'}
`).join('\n')}

## UI结构模式统计
${appMap.structurePatterns.map(p => `- ${p.pattern}: ${p.count}个界面`).join('\n')}

## 节点类型分布（所有界面汇总）
${appMap.nodeTypeDistribution.slice(0, 15).map(n => `- ${n.type}: ${n.count}个`).join('\n')}

## 界面关系分析
${appMap.screenRelationships.map(r => `- 界面${r.screen}: ${r.role} - ${r.reason}`).join('\n')}

## 测试优先级排序
${appMap.testPriority.slice(0, 10).map(p => `
${p.priority === 'high' ? '🔥' : p.priority === 'medium' ? '⭐' : '📍'} 界面${p.screen} (${p.name}) - 优先级: ${p.priority}
   - 评分: ${p.score}
   - 原因: ${p.reasons.join(', ')}
`).join('\n')}

## 全局测试建议
${appMap.globalSuggestions.map(s => `
### ${s.priority === 'high' ? '高优先级' : s.priority === 'medium' ? '中等优先级' : '低优先级'}
- ${s.suggestion}
`).join('\n')}

## 大模型测试策略建议

基于以上认知地图，建议采用以下测试策略：

1. **按优先级测试**: 从高优先级界面开始，逐步覆盖
2. **分层测试**: 入口界面 → 内容界面 → 详情/弹窗界面
3. **重点验证**: 表单验证、导航跳转、交互逻辑
4. **效率优化**: 简单界面快速过，复杂界面深入测
5. **覆盖率目标**: 先覆盖${Math.ceil(appMap.appInfo.totalScreens * 0.6)}个核心界面（60%覆盖率）

预估测试时间: ${Math.round(appMap.screensSummary.totalInteractive * 0.5 / 60)}分钟
`;
}

// 执行
const mapFiles = process.argv.slice(2);
const outputFile = process.argv[process.argv.length - 1];

if (mapFiles.length < 2) {
  console.log('使用方法:');
  console.log('  node scripts/merge-app-map.js <map1.json> <map2.json> ... <output.json>');
  console.log('\n示例:');
  console.log('  node scripts/merge-app-map.js ./maps/home.json ./maps/detail.json ./app-map.json');
  console.log('\n先运行认知地图生成:');
  console.log('  hdc shell "uitest dumpLayout -p /data/local/tmp/screen1.json"');
  console.log('  hdc file recv /data/local/tmp/screen1.json ./maps/home.json');
  console.log('  node scripts/build-cognition-map.js ./maps/home.json ./maps');
  process.exit(0);
}

const actualOutputFile = mapFiles.pop(); // 最后一个参数是输出文件
const maps = loadCognitionMaps(mapFiles);

if (maps.length === 0) {
  console.log('未找到有效的认知地图文件');
  process.exit(1);
}

console.log(`正在合并 ${maps.length} 个认知地图...`);

const appMap = mergeAppMaps(maps);

// 保存JSON
fs.writeFileSync(actualOutputFile, JSON.stringify(appMap, null, 2));

// 生成并保存文本报告
const textReport = generateLLMReadableAppMap(appMap);
const textFile = actualOutputFile.replace('.json', '.md');
fs.writeFileSync(textFile, textReport);

console.log(textReport);
console.log('\n应用地图已保存:');
console.log(`  JSON: ${actualOutputFile}`);
console.log(`  文本: ${textFile}`);