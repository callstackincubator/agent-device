#!/usr/bin/env node
/**
 * 基于静态 UI 分析 / 认知地图的智能深度遍历（带安全护栏）
 * 流程: dumpLayout -> build-cognition-map -> 解析可点击目标 -> 按优先级坐标点击 -> 检测新界面 -> 递归
 *
 * 环境变量:
 *   TRAVERSE_TARGET_BUNDLE  目标应用包名（必填）
 *   TRAVERSE_OPEN_ACTIVITY  重新拉起时使用的 Ability（可选；省略则从 apps --json launchAbility 解析）
 *   TRAVERSE_HDC_TARGET     设备 ID（默认 22M0223824043030）
 *   TRAVERSE_DEVICE         agent-device 设备名（默认 ALT-AL10）
 *   TRAVERSE_SESSION / TRAVERSE_STATE_DIR / TRAVERSE_OUT
 *   TRAVERSE_MAX_DEPTH / TRAVERSE_MAX_TARGETS
 *
 * ONNX 区块检测不在此脚本中集成；单图验证见 onnx-deveco-probe/verify_image.py
 */

import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CLI = './dist/src/cli.js';
const HDC_TARGET = process.env.TRAVERSE_HDC_TARGET || process.env.TRAVERSE_DEVICE || '';
const TARGET_BUNDLE = process.env.TRAVERSE_TARGET_BUNDLE || '';
const OPEN_ACTIVITY = process.env.TRAVERSE_OPEN_ACTIVITY || '';
const OPEN_MODULE = process.env.TRAVERSE_OPEN_MODULE || '';
let cachedLaunchAbility = undefined;
const GLOBAL = [
  '--platform', 'harmonyos',
  '--device', process.env.TRAVERSE_DEVICE || process.env.TRAVERSE_HDC_TARGET || '',
  '--session', process.env.TRAVERSE_SESSION || 'traverse',
  '--state-dir', process.env.TRAVERSE_STATE_DIR || '/private/tmp/agent-device-traverse',
];
const OUT = process.env.TRAVERSE_OUT || './traverse-output/smart-traverse';
const MAX_DEPTH = Number(process.env.TRAVERSE_MAX_DEPTH || 2);
const MAX_TARGETS_PER_SCREEN = Number(process.env.TRAVERSE_MAX_TARGETS || 12);
const RUN_UNTIL_MS = process.env.TRAVERSE_RUN_UNTIL_SEC
  ? Date.now() + Number(process.env.TRAVERSE_RUN_UNTIL_SEC) * 1000
  : null;
const TRACE_PATH = path.join(OUT, 'agent-trace.jsonl');
const DECISION_PATH = path.join(OUT, 'agent-decisions.md');
const LAUNCHER_BUNDLES = new Set(
  (process.env.TRAVERSE_LAUNCHER_BUNDLES || 'com.ohos.sceneboard').split(',').map((s) => s.trim()),
);
const SYSTEM_OVERLAY_BUNDLES = new Set(
  (
    process.env.TRAVERSE_SYSTEM_OVERLAYS ||
    'com.ohos.notificationdialog,com.ohos.commondialog,com.ohos.permissionmanager,com.ohos.locationdialog'
  )
    .split(',')
    .map((s) => s.trim()),
);
const PRIVACY_HINT_RE = /隐私|用户协议|个人信息|服务协议|保护指引/;
const ACCEPT_LABEL_RE = /^(同意|确定|知道了|允许|继续|确认|进入|开始使用|立即体验|我知道了)$/;
const ACCEPT_LABEL_LOOSE_RE = /^同意并|^同意.*使用$|^同意.*继续$/;
const PRIVACY_CENTER_BUNDLE = 'com.huawei.hmos.security.privacycenter';
const DENY_LABEL_RE = /不同意|拒绝|取消|暂不|跳过|关闭应用/;

function traceLog(event, data = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const row = { ts: new Date().toISOString(), event, ...data };
  fs.appendFileSync(TRACE_PATH, `${JSON.stringify(row)}\n`);
}

function decisionLog(markdownLine) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.appendFileSync(DECISION_PATH, `${markdownLine}\n`);
  console.log(`[决策] ${markdownLine.replace(/^#+\s*/, '')}`);
}

function parseBounds(bounds) {
  const m = String(bounds || '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  const x1 = Number(m[1]);
  const y1 = Number(m[2]);
  const x2 = Number(m[3]);
  const y2 = Number(m[4]);
  return {
    x1,
    y1,
    x2,
    y2,
    cx: Math.round((x1 + x2) / 2),
    cy: Math.round((y1 + y2) / 2),
    area: (x2 - x1) * (y2 - y1),
  };
}

function overlaps(a, b) {
  return !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);
}

function walkLayout(node, visitor) {
  if (!node) return;
  visitor(node);
  for (const child of node.children || []) walkLayout(child, visitor);
}

function loadLayoutRoot(filePath) {
  if (!fs.existsSync(filePath)) return [];
  if (fs.statSync(filePath).size === 0) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(raw) ? raw : [raw];
  } catch {
    return [];
  }
}

function getScreenSize(cognition) {
  const res = cognition?.overview?.screenResolution;
  return {
    width: res?.width || 2224,
    height: res?.height || 2496,
    area: (res?.width || 2224) * (res?.height || 2496),
  };
}

function getLayoutBundles(layoutPath) {
  const bundles = new Set();
  for (const root of loadLayoutRoot(layoutPath)) {
    walkLayout(root, (n) => {
      const b = n.attributes?.bundleName;
      if (b) bundles.add(b);
    });
  }
  return bundles;
}

function getFocusedBundleFromLayout(layoutPath) {
  let focused = null;
  for (const root of loadLayoutRoot(layoutPath)) {
    walkLayout(root, (n) => {
      const a = n.attributes || {};
      if (a.focused === 'true' && a.bundleName) focused = a.bundleName;
    });
  }
  return focused;
}

function isDeniedLabel(label) {
  const t = String(label || '').trim();
  if (!t) return false;
  if (ACCEPT_LABEL_RE.test(t)) return false;
  return DENY_LABEL_RE.test(t);
}

function isAcceptLabel(label) {
  const t = String(label || '').trim();
  if (!t) return false;
  return ACCEPT_LABEL_RE.test(t) || ACCEPT_LABEL_LOOSE_RE.test(t);
}

/** 从 raw-layout 提取可点击节点，并用 Text 子区域推断标签 */
function extractClickTargets(layoutPath) {
  if (!layoutPath) return [];
  const roots = loadLayoutRoot(layoutPath);
  const clickables = [];
  const texts = [];

  for (const root of roots) {
    walkLayout(root, (n) => {
      const attrs = n.attributes || {};
      const bounds = parseBounds(attrs.bounds);
      if (!bounds) return;
      if (attrs.type === 'Text' && attrs.text) {
        texts.push({ label: String(attrs.text).trim(), bounds });
      }
      if (attrs.clickable === 'true') {
        clickables.push({
          type: attrs.type || 'unknown',
          bounds: attrs.bounds,
          ...bounds,
          label: (attrs.text || attrs.description || '').trim(),
        });
      }
    });
  }

  for (const c of clickables) {
    if (c.label) continue;
    let best = null;
    let bestArea = Infinity;
    for (const t of texts) {
      if (!overlaps(c, t.bounds)) continue;
      const area = t.bounds.area;
      if (area < bestArea) {
        bestArea = area;
        best = t.label;
      }
    }
    if (best) c.label = best;
  }

  return clickables;
}

function filterChromeTargets(targets, screen) {
  return targets.filter((c) => {
    if (isDeniedLabel(c.label)) return false;
    if (c.cy < 120 && c.area > screen.area * 0.2) return false;
    if (c.y1 < 100 && c.y2 < 200) return false;
    if (c.type === 'Dialog' && c.area > screen.area * 0.65) return false;
    return true;
  });
}

/** 弹窗模式：仅保留「同意/确定」类按钮 */
function buildModalAcceptPlan(clickables, screen) {
  return filterChromeTargets(clickables, screen)
    .filter((c) => isAcceptLabel(c.label))
    .map((c) => ({ ...c, category: 'modal-accept', priority: 1 }))
    .sort((a, b) => b.area - a.area)
    .slice(0, 2);
}

/** 根据认知地图建议 + 几何位置分类并排序 */
function looksLikePrivacyDialog(clickables, cognition) {
  if (cognition?.features?.hasModal) return true;
  const labels = clickables.map((c) => c.label || '').join('\n');
  if (!PRIVACY_HINT_RE.test(labels)) return false;
  return clickables.some((c) => isAcceptLabel(c.label));
}

function buildTestPlan(clickables, cognition) {
  const screen = getScreenSize(cognition);
  const filtered = filterChromeTargets(clickables, screen);

  if (looksLikePrivacyDialog(clickables, cognition)) {
    const modalPlan = buildModalAcceptPlan(clickables, screen);
    if (modalPlan.length > 0) return modalPlan;
  }

  if (cognition?.features?.hasModal) {
    const modalPlan = buildModalAcceptPlan(clickables, screen);
    if (modalPlan.length > 0) return modalPlan;
  }

  const suggestions = cognition?.suggestions || [];
  const patterns = cognition?.structure?.layoutPattern || [];
  const tabFirst =
    cognition?.features?.hasTabs === true ||
    patterns.includes('tab-based') ||
    suggestions.some((s) => s.includes('Tab'));
  const navFirst = suggestions.some((s) => s.includes('导航'));
  const h = screen.height;

  const classified = filtered.map((c) => {
    let category = 'content';
    let priority = 40;
    if (c.cy >= h * 0.88 && c.type === 'Column') {
      category = 'bottom-tab';
      priority = tabFirst ? 10 : 20;
    } else if (c.cy < h * 0.13 && c.type === '__Common__') {
      category = 'top-category';
      priority = navFirst ? 15 : 25;
    } else if (c.type === 'Button') {
      category = 'button';
      priority = 30;
    } else if (c.cy >= h * 0.72 && c.cy < h * 0.88) {
      category = 'content-card';
      priority = 35;
    } else if (c.type === 'Row' && c.cy < h * 0.13) {
      category = 'top-action';
      priority = 28;
    }
    return { ...c, category, priority };
  });

  const order = { 'bottom-tab': 0, 'top-category': 1, button: 2, 'top-action': 3, 'content-card': 4, content: 5 };
  return classified
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        (order[a.category] ?? 9) - (order[b.category] ?? 9) ||
        a.cy - b.cy,
    )
    .slice(0, MAX_TARGETS_PER_SCREEN);
}

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

function dumpLayout(remoteName) {
  const local = path.join(OUT, 'layouts', `${remoteName}.json`);
  fs.mkdirSync(path.dirname(local), { recursive: true });
  const remote = `/data/local/tmp/${remoteName}.json`;
  const dump = spawnSync(
    'hdc',
    ['-t', HDC_TARGET, 'shell', 'uitest', 'dumpLayout', '-p', remote],
    { encoding: 'utf8', timeout: 45_000 },
  );
  if (dump.error || dump.status !== 0 || /DumpLayout failed|timeout/i.test(`${dump.stdout}\n${dump.stderr}`)) {
    if (fs.existsSync(local)) fs.unlinkSync(local);
    return null;
  }
  const recv = spawnSync('hdc', ['-t', HDC_TARGET, 'file', 'recv', remote, local], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (recv.error || recv.status !== 0 || !fs.existsSync(local) || fs.statSync(local).size === 0) {
    if (fs.existsSync(local)) fs.unlinkSync(local);
    return null;
  }
  return local;
}

function buildCognitionMap(layoutPath, screenId) {
  const screenDir = path.join(OUT, 'maps', screenId);
  fs.mkdirSync(screenDir, { recursive: true });
  spawnSync('node', ['scripts/build-cognition-map.js', layoutPath, screenDir], { stdio: 'pipe' });
  const mapPath = path.join(screenDir, 'cognition-map.json');
  return fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, 'utf8')) : null;
}

function screenFingerprint(layoutPath) {
  if (!layoutPath) return { nodes: 0, labels: '', key: '0:' };
  const targets = extractClickTargets(layoutPath);
  const labels = targets.map((t) => t.label || '').filter(Boolean).sort().join('|');
  const roots = loadLayoutRoot(layoutPath);
  let nodes = 0;
  for (const root of roots) walkLayout(root, () => { nodes++; });
  return { nodes, labels, key: `${nodes}:${labels.slice(0, 200)}` };
}

async function getAppStateBundle() {
  const res = await runCli(['appstate']);
  if (!res?.success) return null;
  const d = res.data;
  return d?.appBundleId ?? d?.app ?? d?.package ?? null;
}

function isSystemOverlayBundle(bundle) {
  return LAUNCHER_BUNDLES.has(bundle) || SYSTEM_OVERLAY_BUNDLES.has(bundle);
}

function analyzeLayoutContext(layoutPath) {
  if (!layoutPath) {
    return {
      bundles: [],
      focused: null,
      hasTarget: false,
      launcherOnly: true,
      systemOverlayOnly: false,
      wrongApp: false,
    };
  }
  const bundles = getLayoutBundles(layoutPath);
  const focused = getFocusedBundleFromLayout(layoutPath);
  const appBundles = [...bundles].filter((b) => !isSystemOverlayBundle(b));
  const hasTarget = TARGET_BUNDLE ? bundles.has(TARGET_BUNDLE) : true;
  const launcherOnly = appBundles.length === 0;
  const systemOverlayOnly =
    !hasTarget && appBundles.length === 0 && [...bundles].some((b) => SYSTEM_OVERLAY_BUNDLES.has(b));
  const wrongApp =
    TARGET_BUNDLE &&
    appBundles.length > 0 &&
    !hasTarget &&
    focused &&
    !isSystemOverlayBundle(focused) &&
    focused !== TARGET_BUNDLE;

  return { bundles: [...bundles], focused, hasTarget, launcherOnly, systemOverlayOnly, wrongApp };
}

async function resolveLaunchAbility() {
  if (OPEN_ACTIVITY) return OPEN_ACTIVITY;
  if (cachedLaunchAbility !== undefined) return cachedLaunchAbility;
  if (!TARGET_BUNDLE) {
    cachedLaunchAbility = '';
    return cachedLaunchAbility;
  }
  const res = await runCli(['apps']);
  if (res?.success && Array.isArray(res.data?.apps)) {
    const row = res.data.apps.find(
      (entry) => entry && typeof entry === 'object' && entry.bundleId === TARGET_BUNDLE,
    );
    if (row?.launchAbility) {
      cachedLaunchAbility = row.launchAbility;
      console.log(`  [recover] launchAbility from apps --json: ${cachedLaunchAbility}`);
      return cachedLaunchAbility;
    }
  }
  cachedLaunchAbility = '';
  return cachedLaunchAbility;
}

async function ensureTargetAppForeground(reason) {
  if (!TARGET_BUNDLE) return false;
  console.log(`  [recover] ${reason} → 重新拉起 ${TARGET_BUNDLE}`);
  const ability = await resolveLaunchAbility();
  if (ability) {
    const hdcStart = ['-t', HDC_TARGET, 'shell', 'aa', 'start', '-b', TARGET_BUNDLE, '-a', ability];
    if (OPEN_MODULE) hdcStart.push('-m', OPEN_MODULE);
    spawnSync('hdc', hdcStart);
  }
  const args = ['open', TARGET_BUNDLE];
  if (ability) args.push('--activity', ability);
  if (OPEN_MODULE) args.push('--module', OPEN_MODULE);
  await runCli(args);
  for (let attempt = 0; attempt < 10; attempt++) {
    await sleep(2000);
    const probe = dumpLayout(`recover_probe_${attempt}`);
    const ctx = analyzeLayoutContext(probe);
    if (ctx.hasTarget) {
      console.log(`  [recover] 目标应用 UI 已就绪 (attempt ${attempt + 1})`);
      return true;
    }
    if (ctx.systemOverlayOnly) {
      const overlayPlan = buildModalAcceptPlan(extractClickTargets(probe), null);
      const allow = overlayPlan.find((t) => t.label === '允许' || isAcceptLabel(t.label));
      if (allow) {
        console.log(`  [recover] 处理系统弹窗: ${allow.label} @ (${allow.cx},${allow.cy})`);
        await runCli(['press', String(allow.cx), String(allow.cy)]);
        await sleep(1500);
        continue;
      }
    }
  }
  return false;
}

async function checkTraversalGuard(layoutPath) {
  const ctx = analyzeLayoutContext(layoutPath);
  const appBundle = await getAppStateBundle();
  const appIsLauncher = appBundle && LAUNCHER_BUNDLES.has(appBundle);

  if (ctx.launcherOnly || (appIsLauncher && !ctx.hasTarget)) {
    return { ok: false, reason: 'launcher', ctx, appBundle };
  }
  if (ctx.wrongApp) {
    return { ok: false, reason: 'wrong_app', ctx, appBundle };
  }
  if (TARGET_BUNDLE && !ctx.hasTarget) {
    return { ok: false, reason: 'target_not_visible', ctx, appBundle };
  }
  if (appBundle && appBundle !== TARGET_BUNDLE && !ctx.hasTarget) {
    return { ok: false, reason: 'wrong_app', ctx, appBundle };
  }
  return { ok: true, ctx, appBundle };
}

async function captureScreen(screenId, note) {
  const snap = await runCli(['snapshot']);
  const png = path.join(OUT, 'screens', `${screenId}.png`);
  fs.mkdirSync(path.dirname(png), { recursive: true });
  await runCli(['screenshot', png]);
  if (snap?.success) {
    fs.writeFileSync(path.join(OUT, 'screens', `${screenId}.json`), JSON.stringify(snap, null, 2));
  }
  return { snap, note };
}

async function main() {
  if (!TARGET_BUNDLE) {
    console.error('请设置环境变量 TRAVERSE_TARGET_BUNDLE（目标应用包名）');
    process.exit(1);
  }

  fs.mkdirSync(OUT, { recursive: true });
  const visitedFingerprints = new Set();
  const results = [];
  let screenCounter = 0;
  let aborted = false;

  async function exploreScreen(layoutPath, depth, parentAction) {
    if (aborted) return;
    if (!layoutPath) {
      console.log('  [guard] dumpLayout 失败，跳过本屏');
      aborted = true;
      return;
    }

    const guard = await checkTraversalGuard(layoutPath);
    if (!guard.ok) {
      console.log(
        `  [guard] 停止遍历: ${guard.reason} (appstate=${guard.appBundle}, focused=${guard.ctx.focused}, bundles=${guard.ctx.bundles.join(',')})`,
      );
      const recovered = await ensureTargetAppForeground(guard.reason);
      if (!recovered) {
        aborted = true;
        return;
      }
      const relayout = dumpLayout(`recover_d${depth}_${Date.now()}`);
      const retry = await checkTraversalGuard(relayout);
      if (!retry.ok) {
        console.log('  [guard] 恢复后仍不在目标应用，终止');
        aborted = true;
        return;
      }
      layoutPath = relayout;
    }

    const fp = screenFingerprint(layoutPath);
    if (visitedFingerprints.has(fp.key)) {
      console.log(`  [skip] 已访问界面 fingerprint=${fp.key.slice(0, 60)}...`);
      return;
    }
    visitedFingerprints.add(fp.key);

    screenCounter++;
    const screenId = `s${screenCounter}_d${depth}`;
    let cognition = buildCognitionMap(layoutPath, screenId);

    const pngPath = path.join(OUT, 'screens', `${screenId}.png`);
    fs.mkdirSync(path.dirname(pngPath), { recursive: true });
    await runCli(['screenshot', pngPath]);

    let plan = buildTestPlan(extractClickTargets(layoutPath), cognition);

    console.log(`\n=== 界面 ${screenId} (depth=${depth}) nodes=${fp.nodes} ===`);
    console.log(`  父动作: ${parentAction || 'root'}`);
    console.log(`  前台: ${guard.appBundle || guard.ctx.focused || '-'}`);
    if (cognition?.features?.hasModal) {
      console.log('  弹窗模式: 仅点击同意/确定类按钮');
    }
    if (cognition?.suggestions?.length) {
      console.log(`  认知建议: ${cognition.suggestions.slice(0, 4).join('；')}${cognition.suggestions.length > 4 ? '…' : ''}`);
    }
    console.log(`  计划点击: ${plan.length} 个`);
    decisionLog(
      `- **${screenId}** depth=${depth} nodes=${fp.nodes} 计划=${plan.length}${cognition?.features?.hasModal ? ' [弹窗模式]' : ''}`,
    );
    if (plan.length > 0) {
      decisionLog(
        `  目标: ${plan.slice(0, 6).map((p) => `[${p.category}]${p.label || p.type}`).join(', ')}${plan.length > 6 ? '…' : ''}`,
      );
    }

    const snap = await runCli(['snapshot']);
    if (snap?.success) {
      fs.writeFileSync(path.join(OUT, 'screens', `${screenId}.json`), JSON.stringify(snap, null, 2));
    }

    const screenResult = {
      screenId,
      depth,
      parentAction,
      fingerprint: fp,
      guard: guard.ctx,
      cognition: {
        overview: cognition?.overview,
        suggestions: cognition?.suggestions,
        features: cognition?.features,
        layoutPattern: cognition?.structure?.layoutPattern,
      },
      plan: plan.map((p) => ({
        category: p.category,
        label: p.label || '',
        type: p.type,
        x: p.cx,
        y: p.cy,
        bounds: p.bounds,
      })),
      clicks: [],
    };
    results.push(screenResult);

    for (let i = 0; i < plan.length; i++) {
      if (aborted) break;
      const target = plan[i];
      const actionLabel = target.label || `${target.type}@${target.cx},${target.cy}`;
      const actionDesc = `[${target.category}] press ${target.cx} ${target.cy} (${actionLabel})`;

      const clickGuard = await checkTraversalGuard(layoutPath);
      if (!clickGuard.ok) {
        console.log(`  [guard] 点击前检测到 ${clickGuard.reason}，跳过剩余目标`);
        screenResult.clicks.push({ action: actionDesc, skipped: true, reason: clickGuard.reason });
        await ensureTargetAppForeground(clickGuard.reason);
        break;
      }

      console.log(`  -> 点击 ${i + 1}/${plan.length}: ${actionDesc}`);

      const beforeFp = screenFingerprint(layoutPath);
      const pressRes = await runCli(['press', String(target.cx), String(target.cy)]);
      await sleep(2500);

      const afterLayout = dumpLayout(`${screenId}_after_${i}`);
      const afterCtx = analyzeLayoutContext(afterLayout);
      const afterGuard = await checkTraversalGuard(afterLayout);
      const afterFp = screenFingerprint(afterLayout);

      if (afterCtx.systemOverlayOnly) {
        const overlayPlan = buildModalAcceptPlan(extractClickTargets(afterLayout), cognition);
        if (overlayPlan.length > 0) {
          const ob = overlayPlan[0];
          console.log(`     ~ 系统弹窗，点击: ${ob.label || ob.type} @ (${ob.cx},${ob.cy})`);
          await runCli(['press', String(ob.cx), String(ob.cy)]);
          await sleep(2000);
          layoutPath = dumpLayout(`${screenId}_overlay_${i}`);
          screenResult.clicks.push({
            action: actionDesc,
            pressOk: pressRes?.success ?? false,
            systemOverlayHandled: true,
            isNewScreen: false,
          });
          continue;
        }
      }

      if (!afterGuard.ok) {
        console.log(`     ! 点击后离开目标应用 (${afterGuard.reason})，不递归`);
        traceLog('click_wrong_app', {
          action: actionDesc,
          reason: afterGuard.reason,
          bundles: afterCtx.bundles,
          label: target.label,
        });

        if (afterCtx.bundles.includes(PRIVACY_CENTER_BUNDLE)) {
          decisionLog(
            `- 点击「${target.label}」进入系统隐私中心 \`${PRIVACY_CENTER_BUNDLE}\` → back + recover 后继续本屏`,
          );
          await runCli(['back']);
          await sleep(1500);
        }

        screenResult.clicks.push({
          action: actionDesc,
          pressOk: pressRes?.success ?? false,
          skipped: true,
          reason: afterGuard.reason,
          afterBundles: afterCtx.bundles,
          isNewScreen: false,
        });
        await ensureTargetAppForeground(afterGuard.reason);
        if (isAcceptLabel(target.label)) {
          await sleep(3000);
          const relayout = dumpLayout(`${screenId}_modal_ok`);
          if (relayout && analyzeLayoutContext(relayout).hasTarget) {
            console.log('     ✓ 同意类点击完成，重新扫描本屏并继续遍历');
            traceLog('privacy_accept_reexplore', { screenId, label: target.label });
            const last = screenResult.clicks[screenResult.clicks.length - 1];
            last.skipped = false;
            last.privacyAccepted = true;
            last.reason = 'privacy_flow';
            await exploreScreen(relayout, depth, `${parentAction || 'root'} > ${actionLabel}`);
            return;
          }
        }
        break;
      }

      const nodeDelta = Math.abs(afterFp.nodes - beforeFp.nodes);
      const labelChanged = afterFp.labels !== beforeFp.labels;
      const isNewScreen =
        (nodeDelta > Math.max(15, beforeFp.nodes * 0.12) || labelChanged) &&
        !visitedFingerprints.has(afterFp.key) &&
        afterCtx.hasTarget;

      screenResult.clicks.push({
        action: actionDesc,
        pressOk: pressRes?.success ?? false,
        beforeNodes: beforeFp.nodes,
        afterNodes: afterFp.nodes,
        nodeDelta,
        labelChanged,
        isNewScreen,
        afterLayout,
      });

      if (isNewScreen && depth < MAX_DEPTH) {
        console.log(`     ✓ 新界面 (nodes ${beforeFp.nodes} -> ${afterFp.nodes})，递归遍历`);
        await exploreScreen(afterLayout, depth + 1, actionDesc);
        await runCli(['back']);
        await sleep(1500);
        layoutPath = dumpLayout(`${screenId}_returned_${i}`);
      } else if (isNewScreen) {
        console.log('     ✓ 新界面但已达 maxDepth，仅记录');
        await runCli(['back']);
        await sleep(1500);
      } else {
        console.log(`     - 界面未变化 (nodes ${beforeFp.nodes} -> ${afterFp.nodes})`);
        if (cognition?.features?.hasModal && isAcceptLabel(target.label)) {
          layoutPath = afterLayout;
        }
      }
    }
  }

  function writeReport(round) {
    const report = {
      round,
      targetBundle: TARGET_BUNDLE,
      deviceId: HDC_TARGET,
      outputDir: OUT,
      maxDepth: MAX_DEPTH,
      aborted,
      screensVisited: results.length,
      totalClicks: results.reduce((n, r) => n + r.clicks.length, 0),
      newScreensFromClicks: results.reduce((n, r) => n + r.clicks.filter((c) => c.isNewScreen).length, 0),
      skippedClicks: results.reduce((n, r) => n + r.clicks.filter((c) => c.skipped).length, 0),
      results,
      completedAt: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(OUT, 'smart-traverse-report.json'), JSON.stringify(report, null, 2));

    const appLabel = TARGET_BUNDLE.split('.').pop();
    const md = [
      `# ${appLabel} · 认知驱动深度遍历报告（安全模式）`,
      '',
      `- 目标包: \`${TARGET_BUNDLE}\``,
      `- 设备: \`${HDC_TARGET}\``,
      `- 轮次: ${round}`,
      `- 遍历界面数: ${report.screensVisited}`,
      `- 总点击: ${report.totalClicks}（跳过/护栏: ${report.skippedClicks}）`,
      `- 新界面: ${report.newScreensFromClicks}`,
      `- 是否中止: ${report.aborted}`,
      '',
      '## 安全护栏',
      '- 弹窗 (`hasModal`) 时仅点击：同意/确定/知道了 等',
      '- 永不点击：不同意/拒绝/取消',
      '- 点击前/后校验前台包名与 layout 中的 bundle',
      '- 桌面 (`sceneboard`) 或误开其他 App 时停止并重新 `open` 目标应用',
      '- 仅当 layout 含目标包时才递归子界面',
      '',
      ...results.map((r) => {
        const lines = [
          `### ${r.screenId} (depth ${r.depth})`,
          `- 父动作: ${r.parentAction || 'root'}`,
          `- 计划点击 (${r.plan.length}):`,
          ...r.plan.map((p) => `  - [${p.category}] ${p.label || p.type} → (${p.x}, ${p.y})`),
          `- 执行结果:`,
          ...r.clicks.map((c) => {
            if (c.skipped) return `  - ${c.action}: **跳过** (${c.reason})`;
            if (c.privacyAccepted) return `  - ${c.action}: **隐私同意** (${c.reason || 'ok'})`;
            return `  - ${c.action}: ${c.isNewScreen ? '**新界面**' : '无变化'} (${c.beforeNodes}→${c.afterNodes})`;
          }),
        ];
        return lines.join('\n');
      }),
      '',
      `生成时间: ${report.completedAt}`,
    ].join('\n');

    fs.writeFileSync(path.join(OUT, 'smart-traverse-report.md'), md);
  }

  console.log('=== 认知驱动深度遍历（安全模式）===');
  console.log(`目标应用: ${TARGET_BUNDLE}`);
  console.log(`输出: ${OUT}`);
  if (RUN_UNTIL_MS) {
    console.log(`时长上限: ${process.env.TRAVERSE_RUN_UNTIL_SEC}s（至 ${new Date(RUN_UNTIL_MS).toISOString()}）`);
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    DECISION_PATH,
    `# 滴滴遍历决策日志\n\n- 包名: \`${TARGET_BUNDLE}\`\n- 设备: \`${HDC_TARGET}\`\n- 开始: ${new Date().toISOString()}\n\n`,
  );
  traceLog('traverse_start', {
    bundle: TARGET_BUNDLE,
    maxDepth: MAX_DEPTH,
    runUntilSec: process.env.TRAVERSE_RUN_UNTIL_SEC || null,
  });

  const ready = await ensureTargetAppForeground('bootstrap');
  if (!ready) {
    console.error('无法在设备上拉起目标应用，请确认应用已安装且设备已解锁');
    console.error('若出现 dumpLayout timeout / uitest broadcast：重启设备，然后运行 node scripts/ensure-harmony-uitest-ready.mjs');
    process.exit(1);
  }

  let round = 0;
  while (true) {
    round += 1;
    const elapsedSec = RUN_UNTIL_MS ? Math.round((Date.now() - (RUN_UNTIL_MS - Number(process.env.TRAVERSE_RUN_UNTIL_SEC) * 1000)) / 1000) : 0;
    traceLog('round_start', { round, elapsedSec, screensSoFar: results.length });
    decisionLog(`## 第 ${round} 轮（已访界面 ${results.length}）`);

    if (round > 1) {
      aborted = false;
      visitedFingerprints.clear();
      await ensureTargetAppForeground(`round_${round}`);
    }

    const layoutName = round === 1 ? 'initial' : `round_${round}_initial`;
    const layout = dumpLayout(layoutName);
    if (!layout) {
      console.error(`round ${round}: dumpLayout 失败，终止`);
      traceLog('round_dump_failed', { round });
      break;
    }

    await exploreScreen(layout, 0, round === 1 ? null : `round-${round}`);
    writeReport(round);

    if (!RUN_UNTIL_MS || Date.now() >= RUN_UNTIL_MS) break;
    if (aborted) {
      decisionLog(`- 第 ${round} 轮因护栏中止，尝试 recover 后进入下一轮`);
      aborted = false;
      await ensureTargetAppForeground('round_aborted');
    }
    await sleep(3000);
  }

  traceLog('traverse_done', {
    rounds: round,
    screensVisited: results.length,
    totalClicks: results.reduce((n, r) => n + r.clicks.length, 0),
  });
  writeReport(round);
  console.log(`\n=== 完成（${round} 轮）===`);
  console.log(`界面: ${results.length}, 点击: ${results.reduce((n, r) => n + r.clicks.length, 0)}`);
  console.log(`留痕: ${TRACE_PATH}`);
  console.log(`决策: ${DECISION_PATH}`);
  console.log(`报告: ${path.join(OUT, 'smart-traverse-report.md')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
