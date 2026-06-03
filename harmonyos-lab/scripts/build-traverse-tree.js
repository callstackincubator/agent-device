#!/usr/bin/env node
/**
 * 从已有 smart-traverse-report.json 生成遍历逻辑树（无需重跑设备）。
 *
 * 用法:
 *   node scripts/build-traverse-tree.js traverse-output/xhs-smart-v3
 *   node scripts/build-traverse-tree.js traverse-output/xhs-smart-v3/smart-traverse-report.json
 */

import fs from 'fs';
import path from 'path';

function resolveReportPath(input) {
  const p = path.resolve(input);
  if (p.endsWith('.json')) return p;
  return path.join(p, 'smart-traverse-report.json');
}

function clickStatusLine(c) {
  if (c.skipped) return `跳过 (${c.reason || 'skipped'})`;
  if (c.isNewScreen) return `新界面 (${c.beforeNodes ?? '?'}→${c.afterNodes ?? '?'})`;
  return `无变化 (${c.beforeNodes ?? '?'}→${c.afterNodes ?? '?'})`;
}

function shortLabelFromAction(action) {
  const m = action.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : action.replace(/^\[[^\]]+\]\s*press\s+\d+\s+\d+\s*/, '').trim() || action;
}

const SKIP_REASON_ZH = {
  wrong_app: '点击后前台变成其他应用，安全护栏中止',
  launcher: '回到系统桌面，中止',
};

/** 根据界面上的文字猜一屏在 App 里大概是什么页面 */
function guessScreenName(screen) {
  const labels = screen.fingerprint?.labels || '';
  const hasAgreement = /用户服务协议|Privacy Policy|在线协议|知情同意|隐私/.test(labels);
  const hasLoginChrome = /微信登录|其他登录|快速注册|找回密码/.test(labels);
  const hasFeedTabs = /关注/.test(labels) && /发现/.test(labels);
  const hasFeedContent = /(推荐|附近|首页|市集|直播|笔记)/.test(labels);

  if (hasAgreement && !hasLoginChrome && !hasFeedContent) {
    return '隐私 / 用户协议页';
  }
  if (hasLoginChrome && hasFeedTabs) {
    return '登录引导页（顶栏有关注 / 发现等）';
  }
  if (/微信登录|其他登录|快速注册|找回密码/.test(labels) && /登录/.test(labels)) {
    return '登录 / 注册页';
  }
  if (hasFeedTabs && hasFeedContent) {
    return '首页信息流（有关注 / 发现等 Tab）';
  }
  if (hasFeedTabs) {
    return '带 Tab 的过渡页（关注 / 发现）';
  }
  if (/验证码|反诈|举报/.test(labels)) return '业务表单 / 功能页';
  const parts = labels
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s !== ':' && !/^\d/.test(s))
    .slice(0, 3);
  if (parts.length > 0) return parts.join('、');
  return `未命名界面`;
}

function howWeGotHere(screen, allScreens) {
  if (!screen.parentAction) return '打开 App 后的**首屏**';
  const label = shortLabelFromAction(screen.parentAction);
  const parent = allScreens.find((s) =>
    (s.clicks || []).some((c) => c.action === screen.parentAction && c.isNewScreen),
  );
  const parentName = parent ? guessScreenName(parent) : '上一屏';
  return `在「${parentName}」里点击了 **「${label}」** 才来到本屏`;
}

function describeClickResult(branch, maxDepth) {
  if (branch.skipped) {
    const why = SKIP_REASON_ZH[branch.reason] || branch.reason || '被跳过';
    return `⛔ ${why}`;
  }
  if (branch.isNewScreen && branch.childScreenId) {
    return `✅ **进入下一屏**（脚本记为 \`${branch.childScreenId}\`）`;
  }
  if (branch.unvisitedNewScreen) {
    return `🟡 **内容有变化**，但脚本**没有继续往下逛**（当时 \`maxDepth=${maxDepth}\` 已到顶，只记了一次点击）`;
  }
  if (branch.isNewScreen) return '🟡 判定换屏，但报告里没有对应子屏记录';
  return '⚪ **还在本屏**（元素数量几乎没变）';
}

function buildOneLiner(report, tree) {
  const screens = report.results || [];
  if (screens.length === 0) return '（无界面记录）';
  const pathLabels = [];
  function walk(node) {
    for (const child of node.children || []) {
      const branch = (node.clickBranches || []).find((b) => b.childScreenId === child.screenId);
      if (branch) pathLabels.push(branch.label);
      walk(child);
    }
  }
  for (const root of tree.roots) walk(root);
  const first = guessScreenName(screens[0]);
  if (pathLabels.length === 0) {
    return `主要在「${first}」上尝试点击，没有登记到更深的子屏。`;
  }
  return `从「${first}」出发，沿主路径依次点：${pathLabels.map((l) => `「${l}」`).join(' → ')}，一共深入 **${tree.screensVisited}** 个不同界面。`;
}

function screenTitle(screen) {
  const nodes = screen.fingerprint?.nodes ?? '?';
  const patterns = screen.cognition?.layoutPattern?.join(', ') || '-';
  const modal = screen.cognition?.features?.hasModal ? ' ·弹窗' : '';
  return `${screen.screenId} · depth=${screen.depth} · nodes=${nodes} · ${patterns}${modal}`;
}

/** 子屏：parentAction 与父屏某次 isNewScreen 的 action 一致，且更深、非自身 */
function findChildren(parent, allScreens) {
  const actions = new Set(
    (parent.clicks || []).filter((c) => c.isNewScreen).map((c) => c.action),
  );
  return allScreens.filter(
    (s) =>
      s.screenId !== parent.screenId &&
      s.depth > parent.depth &&
      s.parentAction &&
      actions.has(s.parentAction),
  );
}

function findRoots(allScreens) {
  const roots = allScreens.filter((s) => s.depth === 0 || !s.parentAction);
  if (roots.length > 0) return roots;
  const minDepth = Math.min(...allScreens.map((s) => s.depth));
  return allScreens.filter((s) => s.depth === minDepth);
}

function buildScreenNode(screen, allScreens, visited) {
  if (visited.has(screen.screenId)) {
    return {
      screenId: screen.screenId,
      depth: screen.depth,
      title: screenTitle(screen),
      cycle: true,
      children: [],
      clickBranches: [],
    };
  }
  visited.add(screen.screenId);

  const childScreens = findChildren(screen, allScreens);
  const clickBranches = (screen.clicks || []).map((c) => {
    const child = c.isNewScreen
      ? childScreens.find((ch) => ch.parentAction === c.action)
      : undefined;
    const status = clickStatusLine(c);
    const statusNote =
      c.isNewScreen && !child && !c.skipped ? `${status} · 未子遍历` : status;
    return {
      action: c.action,
      label: shortLabelFromAction(c.action),
      status: statusNote,
      isNewScreen: Boolean(c.isNewScreen),
      skipped: Boolean(c.skipped),
      reason: c.reason,
      childScreenId: child?.screenId,
      unvisitedNewScreen: Boolean(c.isNewScreen && !child && !c.skipped),
    };
  });

  const children = childScreens.map((ch) => buildScreenNode(ch, allScreens, visited));

  return {
    screenId: screen.screenId,
    depth: screen.depth,
    parentAction: screen.parentAction,
    displayName: guessScreenName(screen),
    nodeCount: screen.fingerprint?.nodes,
    title: screenTitle(screen),
    fingerprint: screen.fingerprint,
    cognition: screen.cognition
      ? {
          treeDepth: screen.cognition.overview?.treeDepth,
          layoutPattern: screen.cognition.structure?.layoutPattern,
          features: screen.cognition.features,
          suggestions: screen.cognition.suggestions,
        }
      : undefined,
    clickBranches,
    children,
  };
}

export function buildTraverseTree(report) {
  const screens = report.results || [];
  const visited = new Set();
  const roots = findRoots(screens);
  return {
    targetBundle: report.targetBundle,
    outputDir: report.outputDir,
    screensVisited: report.screensVisited,
    maxDepth: report.maxDepth,
    totalClicks: report.totalClicks,
    roots: roots.map((r) => buildScreenNode(r, screens, visited)),
  };
}

function renderMainPathAscii(node, lines = []) {
  const name = node.displayName || node.screenId;
  lines.push(`【${name}】`);
  const child = node.children?.[0];
  if (child) {
    const branch = (node.clickBranches || []).find((b) => b.childScreenId === child.screenId);
    const clickLabel = branch?.label || '?';
    lines.push(`    │`);
    lines.push(`    │  点击「${clickLabel}」`);
    lines.push(`    ▼`);
    renderMainPathAscii(child, lines);
  }
  const unvisited = (node.clickBranches || []).filter((b) => b.unvisitedNewScreen);
  if (unvisited.length > 0) {
    lines.push(`    │`);
    lines.push(
      `    └─ 在本屏还试了：${unvisited.map((b) => `「${b.label}」`).join('、')}（有变化，但未继续往下逛）`,
    );
  }
  return lines;
}

function renderScreenSections(report, tree) {
  const screens = report.results || [];
  const maxDepth = report.maxDepth ?? '?';
  const sections = [];

  for (let i = 0; i < screens.length; i++) {
    const screen = screens[i];
    const ordinal = i + 1;
    const name = guessScreenName(screen);
    const nodeCount = screen.fingerprint?.nodes ?? '?';
    const arrived = howWeGotHere(screen, screens);

    sections.push(`### 第 ${ordinal} 屏：${name}`);
    sections.push('');
    sections.push(`- **内部编号：** \`${screen.screenId}\`（仅方便对照截图/JSON，可忽略）`);
    sections.push(`- **怎么到这屏：** ${arrived}`);
    sections.push(`- **界面规模：** 约 ${nodeCount} 个 UI 元素`);
    sections.push('');
    sections.push('| 点了什么 | 结果 |');
    sections.push('| -------- | ---- |');

    const clicks = screen.clicks || [];
    if (clicks.length === 0) {
      sections.push('| （无点击记录） | — |');
    } else {
      for (const c of clicks) {
        const label = shortLabelFromAction(c.action);
        const branch = {
          skipped: Boolean(c.skipped),
          reason: c.reason,
          isNewScreen: Boolean(c.isNewScreen),
          childScreenId: screens.find(
            (s) =>
              s.parentAction === c.action &&
              s.screenId !== screen.screenId &&
              s.depth > screen.depth,
          )?.screenId,
          unvisitedNewScreen: Boolean(
            c.isNewScreen &&
              !c.skipped &&
              !screens.some(
                (s) =>
                  s.parentAction === c.action &&
                  s.screenId !== screen.screenId &&
                  s.depth > screen.depth,
              ),
          ),
        };
        sections.push(`| ${label} | ${describeClickResult(branch, maxDepth)} |`);
      }
    }
    sections.push('');
  }
  return sections;
}

function formatMermaidHuman(report, tree) {
  const screens = report.results || [];
  const idToName = new Map(screens.map((s) => [s.screenId, guessScreenName(s)]));
  const lines = ['flowchart TD', '  start([打开 App])'];
  const declared = new Set(['start']);

  function nodeDef(screenId) {
    const nid = mermaidId(screenId);
    if (declared.has(nid)) return nid;
    const label = (idToName.get(screenId) || screenId).replace(/"/g, "'");
    lines.push(`  ${nid}["${label}"]`);
    declared.add(nid);
    return nid;
  }

  function walk(node, fromId, edgeLabel) {
    const nid = nodeDef(node.screenId);
    if (edgeLabel) {
      lines.push(`  ${fromId} -->|"${edgeLabel.replace(/"/g, "'")}"| ${nid}`);
    } else {
      lines.push(`  ${fromId} --> ${nid}`);
    }
    const child = node.children?.[0];
    if (!child) return;
    const branch = (node.clickBranches || []).find((b) => b.childScreenId === child.screenId);
    walk(child, nid, branch?.label || '进入');
  }

  for (const root of tree.roots) walk(root, 'start', null);
  return `${lines.join('\n')}\n`;
}

function renderTreeMd(node, indent = 0) {
  const pad = '  '.repeat(indent);
  const lines = [`${pad}- **${node.title}**`];
  if (node.cycle) {
    lines.push(`${pad}  - ↩ 已访问（环）`);
    return lines;
  }
  for (const b of node.clickBranches || []) {
    const icon = b.skipped ? '⊘' : b.isNewScreen ? '→' : '·';
    let line = `${pad}  - ${icon} \`${b.label}\` — ${b.status}`;
    if (b.childScreenId) line += ` → **${b.childScreenId}**`;
    lines.push(line);
  }
  for (const child of node.children || []) {
    lines.push(...renderTreeMd(child, indent + 1));
  }
  return lines;
}

function renderPathOnlyMd(node, indent = 0) {
  const pad = '  '.repeat(indent);
  const subtitle = node.title
    ? node.title.split(' · ').slice(2).join(' · ')
    : `depth=${node.depth ?? '?'}`;
  const lines = [`${pad}- **${node.screenId}** (${subtitle})`];
  if (node.cycle) return lines;
  for (const b of node.clickBranches || []) {
    if (!b.isNewScreen) continue;
    const tail = b.childScreenId ? '' : ' (未子遍历)';
    lines.push(`${pad}  - → \`${b.label}\`${tail}`);
  }
  for (const child of node.children || []) {
    lines.push(...renderPathOnlyMd(child, indent + 1));
  }
  return lines;
}

function mermaidId(screenId) {
  return screenId.replace(/[^a-zA-Z0-9_]/g, '_');
}

function renderMermaid(node, parentId = null, edges = [], nodes = new Set()) {
  const id = mermaidId(node.screenId);
  if (!nodes.has(id)) {
    nodes.add(id);
  }
  const label = node.screenId.replace(/_/g, '\\_');
  if (parentId) {
    edges.push(`  ${parentId} -->|enter| ${id}`);
  }
  if (node.cycle) return { edges, nodeDefs: nodes };
  for (const b of node.clickBranches || []) {
    if (!b.isNewScreen || !b.childScreenId) continue;
    const child = (node.children || []).find((c) => c.screenId === b.childScreenId);
    if (child) {
      const edgeLabel = b.label.replace(/"/g, "'").slice(0, 40);
      edges.push(`  ${id} -->|"${edgeLabel}"| ${mermaidId(child.screenId)}`);
      renderMermaid(child, null, edges, nodes);
    }
  }
  return { edges, nodeDefs: nodes };
}

function formatMermaid(tree) {
  const parts = ['flowchart TD'];
  for (const root of tree.roots) {
    const { edges, nodeDefs } = renderMermaid(root);
    for (const id of nodeDefs) {
      parts.push(`  ${id}["${id}"]`);
    }
    parts.push(...edges);
  }
  return `${parts.join('\n')}\n`;
}

export function writeTraverseTreeArtifacts(reportPath, options = {}) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const outDir = options.outDir || path.dirname(reportPath);
  const tree = buildTraverseTree(report);

  const enriched = { ...report, traverseTree: tree };
  if (options.patchReportJson !== false) {
    fs.writeFileSync(reportPath, JSON.stringify(enriched, null, 2));
  }

  const oneLiner = buildOneLiner(report, tree);
  const mainPathLines = tree.roots.flatMap((r) => renderMainPathAscii(r));

  const md = [
    '# 遍历怎么走（可读版）',
    '',
    '## 这份报告在说什么？',
    '',
    '自动遍历脚本会像人一样：**在当前界面挑几个可点项 → 点一下 → 看有没有换屏 → 换屏了就继续往里逛**。本文件把这件事用**中文步骤**说清楚；技术细节见文末。',
    '',
    '## 一句话总结',
    '',
    oneLiner,
    '',
    '## 主路径（只看「真的换了一屏」的线）',
    '',
    '```',
    ...mainPathLines,
    '```',
    '',
    '## 逐步回放（推荐先看这里）',
    '',
    ...renderScreenSections(report, tree),
    '## 结果符号说明',
    '',
    '| 符号 | 含义 |',
    '| ---- | ---- |',
    '| ✅ | 进入报告里登记的**下一屏**，脚本继续递归 |',
    '| 🟡 | 点击后 layout 变了，但**没有继续往下逛**（常见原因：`maxDepth` 已到） |',
    '| ⚪ | 点了，但**仍停在本屏** |',
    '| ⛔ | **没走完点击**（误开其他 App、回桌面等，安全护栏拦截） |',
    '',
    '## 名词说明（看不懂编号时看这里）',
    '',
    '- **`s1_d0` / `s2_d1` 等**：内部屏幕编号，不是业务名；`s` = 第几个登记的屏，`d` = 遍历深度。',
    '- **`nodes=102`**：这一屏 UI 树里大约有多少个节点，只表示复杂度，不是业务字段。',
    '- **`maxDepth`**：最多往里逛几层；本次为 **' +
      String(report.maxDepth ?? '?') +
      '**，所以最深只登记到 depth=' +
      String(report.maxDepth ?? '?') +
      ' 的屏。',
    '',
    '## 流程图（Mermaid）',
    '',
    '用 VS Code / Cursor 预览 `smart-traverse-tree.mmd`，或把下面代码贴到 [Mermaid Live](https://mermaid.live)。',
    '',
    '```mermaid',
    formatMermaidHuman(report, tree).trimEnd(),
    '```',
    '',
    '---',
    '',
    '## 附录：技术向决策树',
    '',
    '<details>',
    '<summary>展开查看（含 screenId、nodes、layoutPattern）</summary>',
    '',
    ...tree.roots.flatMap((r) => renderTreeMd(r)),
    '',
    '</details>',
    '',
    `生成时间: ${new Date().toISOString()} · 来源 \`${path.basename(reportPath)}\` · 包名 \`${tree.targetBundle || '-'}\``,
  ].join('\n');

  const mdPath = path.join(outDir, 'smart-traverse-tree.md');
  const mmdPath = path.join(outDir, 'smart-traverse-tree.mmd');
  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(mmdPath, formatMermaidHuman(report, tree));

  return { tree, mdPath, mmdPath, reportPath };
}

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('用法: node scripts/build-traverse-tree.js <traverse-output-dir|report.json>');
    process.exit(1);
  }
  const reportPath = resolveReportPath(input);
  if (!fs.existsSync(reportPath)) {
    console.error(`找不到: ${reportPath}`);
    process.exit(1);
  }
  const { mdPath, mmdPath } = writeTraverseTreeArtifacts(reportPath);
  console.log(`已写入: ${mdPath}`);
  console.log(`已写入: ${mmdPath}`);
  console.log(`已更新: ${reportPath} (追加 traverseTree 字段)`);
}

import { pathToFileURL } from 'url';

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
