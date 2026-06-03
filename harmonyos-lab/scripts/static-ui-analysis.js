#!/usr/bin/env node
/**
 * HarmonyOS 静态 UI 分析工具
 * 分析 uitest dumpLayout 导出的 JSON 文件
 */

import fs from 'fs';
import path from 'path';

function analyzeArkUITree(node, depth = 0) {
  const stats = {
    totalNodes: 0,
    maxDepth: depth,
    nodeTypes: {},
    clickableNodes: 0,
    visibleNodes: 0,
    depthDistribution: {},
    boundsList: [],
  };

  function traverse(n, d) {
    if (!n) return;

    stats.totalNodes++;
    if (d > stats.maxDepth) stats.maxDepth = d;

    // 统计节点类型
    const type = n.attributes?.type || 'unknown';
    stats.nodeTypes[type] = (stats.nodeTypes[type] || 0) + 1;

    // 统计深度分布
    stats.depthDistribution[d] = (stats.depthDistribution[d] || 0) + 1;

    // 统计交互节点
    if (n.attributes?.clickable === 'true') stats.clickableNodes++;

    // 统计可见节点
    if (n.attributes?.visible !== 'false') stats.visibleNodes++;

    // 记录 bounds
    if (n.attributes?.bounds) {
      stats.boundsList.push({
        type,
        depth: d,
        bounds: n.attributes.bounds,
      });
    }

    // 递归遍历子节点
    if (n.children && Array.isArray(n.children)) {
      n.children.forEach(child => traverse(child, d + 1));
    }
  }

  // 处理根节点可能是数组或对象
  if (Array.isArray(node)) {
    node.forEach(n => traverse(n, depth));
  } else {
    traverse(node, depth);
  }

  return stats;
}

function buildUITreeReport(jsonPath) {
  const rawData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const stats = analyzeArkUITree(rawData);

  // 生成报告
  const report = {
    source: jsonPath,
    analysisType: 'static',
    summary: {
      totalNodes: stats.totalNodes,
      maxDepth: stats.maxDepth,
      clickableNodes: stats.clickableNodes,
      visibleNodes: stats.visibleNodes,
      avgDepth: Math.round(
        Object.entries(stats.depthDistribution)
          .reduce((sum, [d, count]) => sum + parseInt(d) * count, 0) / stats.totalNodes
      ),
    },
    nodeTypes: Object.entries(stats.nodeTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([type, count]) => ({ type, count })),
    depthDistribution: Object.entries(stats.depthDistribution)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .map(([depth, count]) => ({ depth: parseInt(depth), count })),
    interactiveElements: stats.boundsList
      .filter(b => b.type.includes('Button') || b.type.includes('Text'))
      .slice(0, 10),
  };

  return report;
}

// 执行分析
const inputFile = process.argv[2] || './traverse-output/raw-layout.json';
const outputFile = process.argv[3] || './traverse-output/static-analysis.json';

if (fs.existsSync(inputFile)) {
  const report = buildUITreeReport(inputFile);
  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));

  console.log('=== 静态 UI 分析报告 ===');
  console.log(`源文件: ${inputFile}`);
  console.log(`输出: ${outputFile}`);
  console.log('\n统计摘要:');
  console.log(`  总节点数: ${report.summary.totalNodes}`);
  console.log(`  最大深度: ${report.summary.maxDepth}`);
  console.log(`  平均深度: ${report.summary.avgDepth}`);
  console.log(`  可交互节点: ${report.summary.clickableNodes}`);
  console.log(`  可见节点: ${report.summary.visibleNodes}`);
  console.log('\n节点类型分布 (Top 10):');
  report.nodeTypes.slice(0, 10).forEach(t => {
    console.log(`  ${t.type}: ${t.count}`);
  });
} else {
  console.log(`文件不存在: ${inputFile}`);
  console.log('\n使用方法:');
  console.log('  1. 先导出 UI 布局:');
  console.log('     hdc shell "uitest dumpLayout -p /data/local/tmp/layout.json"');
  console.log('     hdc file recv /data/local/tmp/layout.json ./layout.json');
  console.log('  2. 运行分析:');
  console.log('     node scripts/static-ui-analysis.js ./layout.json');
}