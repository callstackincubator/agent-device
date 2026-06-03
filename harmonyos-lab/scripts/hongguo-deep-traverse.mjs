#!/usr/bin/env node
/**
 * 红果短剧 (com.phoenix.read.next) HarmonyOS 深度遍历
 * 设备: 22M0223824043030 (ALT-AL10)
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const CLI = './dist/src/cli.js';
const GLOBAL = [
  '--platform', 'harmonyos',
  '--device', 'ALT-AL10',
  '--session', 'hongguo-traverse',
  '--state-dir', '/private/tmp/agent-device-hongguo-traverse',
];
const OUT = './traverse-output/hongguo';
const BOTTOM_TABS = ['短剧', '剧场', '福利', '我的'];
const TOP_CATEGORIES = ['找剧', '漫剧', '电影', '听书', '小说', '经典', '知识'];

function runCli(args) {
  return new Promise((resolve) => {
    const proc = spawn('node', [CLI, ...GLOBAL, ...args, '--json'], { encoding: 'utf8' });
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', () => {});
    proc.on('close', () => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve(null);
      }
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function statsFromSnapshot(result) {
  if (!result?.success) return null;
  const nodes = result.data?.nodes ?? [];
  const depths = nodes.map((n) => n.depth ?? 0);
  const interactive = nodes.filter((n) => n.hittable);
  const labels = nodes
    .filter((n) => n.label || n.value)
    .map((n) => String(n.label || n.value))
    .filter((l) => l.length > 0 && l.length < 30);
  return {
    nodeCount: nodes.length,
    maxDepth: depths.length ? Math.max(...depths) : 0,
    interactiveCount: interactive.length,
    sampleLabels: [...new Set(labels)].slice(0, 20),
    interactiveRefs: interactive.slice(0, 12).map((n) => ({
      ref: n.ref,
      type: n.type,
      label: n.label || n.value || '',
    })),
  };
}

async function main() {
  fs.mkdirSync(path.join(OUT, 'screens'), { recursive: true });
  const screens = [];
  let num = 0;

  async function capture(name, action = 'snapshot') {
    num++;
    const snap = await runCli(['snapshot']);
    const shot = await runCli(['screenshot', path.join(OUT, 'screens', `screen_${num}.png`)]);
    const stats = statsFromSnapshot(snap);
    const entry = { num, name, action, ...stats, screenshotOk: shot?.success ?? false };
    screens.push(entry);
    if (snap?.success) {
      fs.writeFileSync(
        path.join(OUT, 'screens', `screen_${num}.json`),
        JSON.stringify(snap, null, 2),
      );
    }
    console.log(`[${num}] ${name}: nodes=${stats?.nodeCount ?? '?'} interactive=${stats?.interactiveCount ?? '?'}`);
    return snap;
  }

  console.log('=== 红果深度遍历 ===');
  await capture('初始界面-短剧首页');

  for (const tab of BOTTOM_TABS.slice(1)) {
    await runCli(['press', `label="${tab}"`]);
    await sleep(2500);
    await capture(`底部Tab-${tab}`, `press label="${tab}"`);
  }

  await runCli(['press', 'label="短剧"']);
  await sleep(1500);

  for (const cat of TOP_CATEGORIES.slice(0, 4)) {
    await runCli(['press', `label="${cat}"`]);
    await sleep(2000);
    await capture(`顶部分类-${cat}`, `press label="${cat}"`);
  }

  await runCli(['press', 'label="短剧"']);
  await sleep(1500);

  const homeSnap = await runCli(['snapshot']);
  const clickables = (homeSnap?.data?.nodes ?? []).filter((n) => n.hittable);
  const tried = clickables.slice(0, 5);

  for (const node of tried) {
    const label = node.label || node.value || node.type || 'unknown';
    await runCli(['press', node.ref]);
    await sleep(2500);
    const after = await capture(`点击-${node.ref}-${label}`, `press ${node.ref}`);
    const afterNodes = after?.data?.nodes?.length ?? 0;
    const beforeNodes = homeSnap?.data?.nodes?.length ?? 0;
    if (Math.abs(afterNodes - beforeNodes) > beforeNodes * 0.15) {
      await runCli(['back']);
      await sleep(1500);
    }
  }

  await runCli(['scroll', 'down', '0.5']);
  await sleep(1500);
  await capture('向下滚动后');

  await runCli(['scroll', 'up', '0.5']);
  await sleep(1000);

  const summary = {
    app: 'com.phoenix.read.next',
    appName: '红果短剧',
    deviceId: '22M0223824043030',
    deviceName: 'ALT-AL10',
    platform: 'harmonyos',
    session: 'hongguo-traverse',
    totalScreens: screens.length,
    screens,
    totals: {
      totalNodes: screens.reduce((s, x) => s + (x.nodeCount || 0), 0),
      maxDepth: Math.max(...screens.map((x) => x.maxDepth || 0), 0),
      avgNodes: Math.round(
        screens.reduce((s, x) => s + (x.nodeCount || 0), 0) / screens.length,
      ),
    },
    completedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(OUT, 'traverse-summary.json'), JSON.stringify(summary, null, 2));

  const md = [
    '# 红果短剧 HarmonyOS 深度遍历报告',
    '',
    `- 设备: ALT-AL10 (\`22M0223824043030\`)`,
    `- 包名: \`com.phoenix.read.next\``,
    `- 遍历界面数: ${screens.length}`,
    `- 最大 UI 深度: ${summary.totals.maxDepth}`,
    `- 平均节点数: ${summary.totals.avgNodes}`,
    '',
    '## 界面列表',
    '',
    ...screens.map(
      (s) =>
        `### ${s.num}. ${s.name}\n- 节点: ${s.nodeCount} | 可交互: ${s.interactiveCount} | 深度: ${s.maxDepth}\n- 标签样例: ${(s.sampleLabels || []).slice(0, 8).join(', ')}`,
    ),
    '',
    `生成时间: ${summary.completedAt}`,
  ].join('\n');

  fs.writeFileSync(path.join(OUT, 'traverse-report.md'), md);
  console.log('\n=== 完成 ===');
  console.log(`界面数: ${screens.length}`);
  console.log(`报告: ${OUT}/traverse-report.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
