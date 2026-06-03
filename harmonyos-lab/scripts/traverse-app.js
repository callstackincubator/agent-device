#!/usr/bin/env node
/**
 * HarmonyOS App Deep Traversal Script
 * 自动遍历应用界面，统计所有View树信息
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const CLI_PATH = './dist/src/cli.js';

async function runCliAsync(command, session) {
  return new Promise((resolve) => {
    const args = command.split(' ').concat(['--session', session, '--json']);
    const proc = spawn('node', [CLI_PATH, ...args], { encoding: 'utf8' });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      if (code === 0 && stdout) {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });

    proc.on('error', () => resolve(null));
  });
}

function runCli(command, session) {
  const args = command.split(' ').concat(['--session', session, '--json']);
  const proc = spawn('node', [CLI_PATH, ...args], {
    stdio: ['inherit', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

  let stdout = '';
  try {
    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', () => {});

    proc.stdin.end();
    proc.stdout.resume();

    // 简单同步等待
    while (!proc.killed && proc.exitCode === null) {
      proc.stdin.end();
      proc.stdout.resume();
    }
  } catch {}

  if (stdout) {
    try {
      return JSON.parse(stdout);
    } catch {
      return null;
    }
  }
  return null;
}

function getSnapshotStats(session) {
  const result = runCli('snapshot', session);
  if (!result || !result.success) return null;

  const nodes = result.data.nodes || [];
  const depths = nodes.map(n => n.depth || 0);
  const types = nodes.map(n => n.type || 'unknown');
  const interactive = nodes.filter(n => n.hittable);

  return {
    nodeCount: nodes.length,
    maxDepth: Math.max(...depths, 0),
    minDepth: Math.min(...depths, 0),
    avgDepth: depths.length > 0 ? Math.round(depths.reduce((a, b) => a + b, 0) / depths.length) : 0,
    interactiveCount: interactive.length,
    nodeTypes: [...new Set(types)].filter(t => t),
    depthDistribution: getDepthDistribution(nodes),
  };
}

function getDepthDistribution(nodes) {
  const dist = {};
  nodes.forEach(n => {
    const d = n.depth || 0;
    dist[d] = (dist[d] || 0) + 1;
  });
  return dist;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function traverseApp(session, outputDir) {
  console.log('=== App Deep Traversal ===');
  console.log(`Session: ${session}`);
  console.log(`Output: ${outputDir}`);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'screens'), { recursive: true });

  const screens = [];
  let screenNum = 1;

  // 保存初始界面
  console.log('\n--- Screen 1: Initial ---');
  const stats = getSnapshotStats(session);
  if (stats) {
    screens.push({ name: 'initial', num: screenNum, ...stats });
    console.log(`  Nodes: ${stats.nodeCount}, Depth: ${stats.maxDepth}, Interactive: ${stats.interactiveCount}`);
    console.log(`  Node types: ${stats.nodeTypes.slice(0, 5).join(', ')}...`);

    // 保存完整快照
    const snapshotResult = runCli('snapshot', session);
    fs.writeFileSync(
      path.join(outputDir, 'screens', `screen_${screenNum}.json`),
      JSON.stringify(snapshotResult, null, 2)
    );
  }

  // 尝试点击交互元素并遍历子界面
  const maxScreens = 10;
  const visitedRefs = new Set();

  while (screenNum < maxScreens) {
    const snapshotResult = runCli('snapshot', session);
    if (!snapshotResult?.success) break;

    const interactiveNodes = (snapshotResult.data.nodes || []).filter(n => n.hittable && !visitedRefs.has(n.ref));

    if (interactiveNodes.length === 0) break;

    // 选择一个未访问的交互元素
    const target = interactiveNodes[0];
    const ref = target.ref;
    const label = target.label || target.value || target.type || 'unknown';

    visitedRefs.add(ref);

    console.log(`\n--- Trying click: ${ref} (${label}) ---`);

    // 点击
    runCli(`press ${ref}`, session);

    // 等待界面变化
    await sleep(2000);

    // 检测是否是新界面
    const newStats = getSnapshotStats(session);
    if (!newStats) break;

    // 如果节点数变化超过30%，认为是新界面
    const prevNodeCount = screens.length > 0 ? screens[screens.length - 1].nodeCount : 0;
    const nodeDiff = Math.abs(newStats.nodeCount - prevNodeCount);
    const isNewScreen = nodeDiff > prevNodeCount * 0.3 || newStats.nodeCount > 50;

    if (isNewScreen) {
      screenNum++;
      screens.push({ name: label, num: screenNum, ...newStats });
      console.log(`  Screen ${screenNum}: Nodes: ${newStats.nodeCount}, Depth: ${newStats.maxDepth}`);

      // 保存快照
      const newSnapshot = runCli('snapshot', session);
      fs.writeFileSync(
        path.join(outputDir, 'screens', `screen_${screenNum}.json`),
        JSON.stringify(newSnapshot, null, 2)
      );

      // 尝试返回
      runCli('back', session);
      await sleep(1000);
    }
  }

  // 生成汇总报告
  const summary = {
    session,
    platform: 'harmonyos',
    totalScreens: screens.length,
    totalNodes: screens.reduce((sum, s) => sum + s.nodeCount, 0),
    averageNodes: Math.round(screens.reduce((sum, s) => sum + s.nodeCount, 0) / screens.length),
    maxDepthAllScreens: Math.max(...screens.map(s => s.maxDepth), 0),
    screens: screens.map(s => ({
      name: s.name,
      num: s.num,
      nodes: s.nodeCount,
      depth: s.maxDepth,
      interactive: s.interactiveCount,
      types: s.nodeTypes.slice(0, 5),
    })),
    completedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log('\n=== Traversal Complete ===');
  console.log(`Total screens visited: ${screens.length}`);
  console.log(`Total nodes analyzed: ${summary.totalNodes}`);
  console.log(`Maximum UI depth: ${summary.maxDepthAllScreens}`);
  console.log(`Report saved: ${path.join(outputDir, 'summary.json')}`);

  return summary;
}

// 执行
const session = process.argv[2] || 'xhs-traverse';
const outputDir = process.argv[3] || './traverse-output';

traverseApp(session, outputDir);