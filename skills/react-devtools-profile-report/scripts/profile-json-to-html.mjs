#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function usage() {
  console.error(`Usage: profile-json-to-html.mjs <profile.json> <report.html> [options]

Options:
  --title <text>       Report title. Defaults to "React DevTools Profile Report".
  --evidence <path>    Optional screenshot, trace, or other evidence file to link.
  --limit <number>     Rows per report table. Defaults to 25.
  --help               Show this help.`);
}

function parseArgs(argv) {
  const positional = [];
  const options = { title: 'React DevTools Profile Report', evidence: [], limit: 25 };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--title') {
      options.title = requiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--evidence') {
      options.evidence.push(requiredValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === '--limit') {
      const limit = Number.parseInt(requiredValue(argv, index, arg), 10);
      if (!Number.isFinite(limit) || limit <= 0) throw new Error('--limit must be positive');
      options.limit = limit;
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    positional.push(arg);
  }

  if (positional.length !== 2) {
    usage();
    process.exit(1);
  }

  return { inputPath: positional[0], outputPath: positional[1], options };
}

function requiredValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${option} requires a value`);
  return value;
}

function summarizeProfile(profile) {
  const roots = profile.dataForRoots ?? [];
  if (!Array.isArray(roots) || roots.length === 0) {
    throw new Error(
      'Profile JSON does not contain dataForRoots. Export a React DevTools profile first.',
    );
  }

  const components = new Map();
  const commits = [];
  const rootRows = [];
  let windowStart = Number.POSITIVE_INFINITY;
  let windowEnd = 0;
  let totalDuration = 0;
  let totalRenderedFibers = 0;

  for (const root of roots) {
    const snapshots = new Map(root.snapshots ?? []);
    const commitData = root.commitData ?? [];
    let rootTotalDuration = 0;
    let rootMaxCommit = 0;
    let rootMaxCommitIndex = 0;

    commitData.forEach((commit, commitIndex) => {
      const duration = Number(commit.duration || 0);
      const timestamp = Number(commit.timestamp || 0);
      const fibers = commit.fiberActualDurations ?? [];
      const selfDurations = new Map(commit.fiberSelfDurations ?? []);
      const changes = new Map(commit.changeDescriptions ?? []);
      const topFiber = fibers.reduce(
        (best, item) => (Number(item[1]) > Number(best?.[1] ?? -1) ? item : best),
        null,
      );

      windowStart = Math.min(windowStart, timestamp);
      windowEnd = Math.max(windowEnd, timestamp + duration);
      totalDuration += duration;
      totalRenderedFibers += fibers.length;
      rootTotalDuration += duration;

      if (duration > rootMaxCommit) {
        rootMaxCommit = duration;
        rootMaxCommitIndex = commitIndex;
      }

      commits.push({
        root: root.displayName || `Root ${root.rootID}`,
        commit: commitIndex,
        duration,
        timestamp,
        components: fibers.length,
        priority: commit.priorityLevel || '',
        topComponent: topFiber ? componentName(snapshots.get(topFiber[0]), topFiber[0]) : '',
        topComponentMs: topFiber ? Number(topFiber[1]) : 0,
        updater: (commit.updaters ?? [])
          .map((updater) => updater.displayName || `#${updater.id}`)
          .filter(Boolean)
          .join(', '),
      });

      for (const [id, actual] of fibers) {
        const key = `${root.rootID}:${id}`;
        const node = snapshots.get(id);
        const entry = components.get(key) ?? {
          id,
          root: root.displayName || `Root ${root.rootID}`,
          name: componentName(node, id),
          renders: 0,
          totalActual: 0,
          maxActual: 0,
          totalSelf: 0,
          maxSelf: 0,
          firstCommit: commitIndex,
          lastCommit: commitIndex,
          causes: {},
          changedProps: {},
          changedHooks: {},
          changedState: {},
        };

        const actualMs = Number(actual || 0);
        const selfMs = Number(selfDurations.get(id) || 0);
        entry.renders += 1;
        entry.totalActual += actualMs;
        entry.maxActual = Math.max(entry.maxActual, actualMs);
        entry.totalSelf += selfMs;
        entry.maxSelf = Math.max(entry.maxSelf, selfMs);
        entry.lastCommit = commitIndex;

        const change = changes.get(id);
        mergeCounts(entry.causes, changeCauses(change));
        if (Array.isArray(change?.props)) mergeCounts(entry.changedProps, change.props);
        if (Array.isArray(change?.hooks)) {
          mergeCounts(
            entry.changedHooks,
            change.hooks.map((hook) => `#${hook}`),
          );
        }
        if (Array.isArray(change?.state)) mergeCounts(entry.changedState, change.state);
        components.set(key, entry);
      }
    });

    rootRows.push({
      name: root.displayName || `Root ${root.rootID}`,
      id: root.rootID,
      commits: commitData.length,
      snapshots: (root.snapshots ?? []).length,
      totalDuration: rootTotalDuration,
      maxCommit: rootMaxCommit,
      maxCommitIndex: rootMaxCommitIndex,
    });
  }

  const componentRows = [...components.values()].map((component) => ({
    ...component,
    avgActual: component.totalActual / Math.max(component.renders, 1),
    avgSelf: component.totalSelf / Math.max(component.renders, 1),
    causesText: countText(component.causes),
    changedText: changedText(component),
  }));

  return {
    roots: rootRows,
    commits,
    components: componentRows,
    summary: {
      rootCount: roots.length,
      commitCount: commits.length,
      componentCount: componentRows.length,
      totalDuration,
      totalRenderedFibers,
      windowMs:
        Number.isFinite(windowStart) && windowEnd > windowStart ? windowEnd - windowStart : 0,
      maxCommit: [...commits].sort((a, b) => b.duration - a.duration)[0] ?? null,
    },
  };
}

function componentName(node, id) {
  const name = node?.displayName || '(anonymous)';
  const hocs = Array.isArray(node?.hocDisplayNames) ? node.hocDisplayNames.join(' -> ') : '';
  return hocs ? `${name} (${hocs})` : name || `#${id}`;
}

function changeCauses(change) {
  if (!change) return ['unknown'];
  const causes = [];
  if (change.isFirstMount) causes.push('first-mount');
  if (change.didHooksChange) causes.push('hooks-changed');
  if (Array.isArray(change.props) && change.props.length > 0) causes.push('props-changed');
  if (Array.isArray(change.state) && change.state.length > 0) causes.push('state-changed');
  if (change.context) causes.push('context-changed');
  return causes.length > 0 ? causes : ['parent-rendered'];
}

function mergeCounts(target, values) {
  for (const value of values) target[value] = (target[value] ?? 0) + 1;
}

function countText(values, limit = 8) {
  return Object.entries(values)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => `${name} (${count})`)
    .join(', ');
}

function changedText(component) {
  return [
    ...Object.entries(component.changedProps).map(([name, count]) => `prop:${name} (${count})`),
    ...Object.entries(component.changedHooks).map(([name, count]) => `hook:${name} (${count})`),
    ...Object.entries(component.changedState).map(([name, count]) => `state:${name} (${count})`),
  ]
    .sort((a, b) => countSuffix(b) - countSuffix(a))
    .slice(0, 8)
    .join(', ');
}

function countSuffix(value) {
  return Number(value.match(/\((\d+)\)$/)?.[1] ?? 0);
}

function renderReport(report, meta) {
  const slowestCommits = top(report.commits, 'duration', meta.limit);
  const slowestAvg = top(report.components, 'avgActual', meta.limit);
  const mostRenders = top(report.components, 'renders', meta.limit);
  const highestTotal = top(report.components, 'totalActual', meta.limit);

  return `<!doctype html>
<html lang="en">
${head(meta.title)}
<body>
  <header>
    <h1>${escapeHtml(meta.title)}</h1>
    <p>Source: <a href="${escapeAttr(meta.sourceHref)}">${escapeHtml(meta.sourceLabel)}</a> · Generated: ${escapeHtml(new Date().toLocaleString())}</p>
  </header>
  <main>
    ${summaryCards(report.summary)}
    <p class="note">"React render commit" means a React Profiler update cycle, not a Git commit. If startup was included, the first commit may dominate the report and should be separated from interaction-specific offenders.</p>
    <h2>Render Commit Timeline</h2>
    ${timelineSvg(report.commits)}
    ${componentTable('Slowest Avg Render', slowestAvg)}
    ${componentTable('Highest Total Render Time', highestTotal)}
    ${componentTable('Most Re-renders', mostRenders)}
    ${commitTable('Slowest React Render Commits', slowestCommits)}
    ${rootsTable(report.roots)}
    ${evidence(meta.evidence)}
  </main>
</body>
</html>`;
}

function head(title) {
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; --bg:#101418; --panel:#171d23; --panel2:#1f2730; --text:#eef3f8; --muted:#9ba8b5; --line:#2e3844; --accent:#70d6ff; --warn:#ffcf66; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    header { padding: 28px 32px 18px; border-bottom: 1px solid var(--line); background: #121820; }
    header p { margin: 0; color: var(--muted); }
    h1 { margin: 0 0 6px; font-size: 26px; letter-spacing: 0; }
    h2 { margin: 32px 0 12px; font-size: 18px; letter-spacing: 0; }
    a { color: var(--accent); }
    main { padding: 24px 32px 48px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin: 18px 0; }
    .card, .table-wrap { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
    .card { padding: 14px; }
    .metric { color: var(--muted); font-size: 12px; text-transform: uppercase; }
    .value { font-size: 24px; margin-top: 4px; font-weight: 650; }
    .note { border-left: 3px solid var(--warn); padding: 10px 12px; background: rgba(255, 207, 102, 0.08); color: #ffe6a8; }
    .timeline { width: 100%; height: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
    .table-wrap { overflow: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 980px; }
    th, td { padding: 9px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; white-space: nowrap; }
    th { background: var(--panel2); color: var(--muted); font-weight: 600; }
    td.wrap { white-space: normal; min-width: 260px; }
    td.detail { white-space: normal; min-width: 300px; color: var(--muted); }
    .evidence img { max-width: 100%; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
    @media (max-width: 720px) { header, main { padding-left: 16px; padding-right: 16px; } .value { font-size: 20px; } }
  </style>
</head>`;
}

function summaryCards(summary) {
  return `<section class="grid">
    ${card('Profile Window', sec(summary.windowMs))}
    ${card('React Render Commits', int(summary.commitCount))}
    ${card('Components Seen', int(summary.componentCount))}
    ${card('Slowest React Render Commit', ms(summary.maxCommit?.duration))}
    ${card('Total Render Time', sec(summary.totalDuration))}
    ${card('Rendered Fibers', int(summary.totalRenderedFibers))}
  </section>`;
}

function card(label, value) {
  return `<div class="card"><div class="metric">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`;
}

function timelineSvg(commits) {
  const width = 1200;
  const height = 220;
  const pad = 24;
  const maxDuration = Math.max(...commits.map((commit) => commit.duration), 1);
  const points = commits
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((commit, index) => {
      const x = pad + ((width - pad * 2) * index) / Math.max(commits.length - 1, 1);
      const y = height - pad - ((height - pad * 2) * commit.duration) / maxDuration;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  return `<svg class="timeline" viewBox="0 0 ${width} ${height}" role="img" aria-label="React render commit duration timeline">
    <path d="${points}" fill="none" stroke="#70d6ff" stroke-width="2" />
    <text x="8" y="20" fill="#9ba8b5">${escapeHtml(ms(maxDuration))}</text>
    <text x="8" y="${height - 8}" fill="#9ba8b5">0ms</text>
  </svg>`;
}

function componentTable(title, rows) {
  return table(
    title,
    [
      'Component',
      'Root',
      'Renders',
      'Avg render',
      'Max render',
      'Total render',
      'Causes',
      'Changed',
    ],
    rows.map((row) => [
      wrap(row.name),
      row.root,
      int(row.renders),
      ms(row.avgActual),
      ms(row.maxActual),
      ms(row.totalActual),
      detail(row.causesText),
      detail(row.changedText),
    ]),
  );
}

function commitTable(title, rows) {
  return table(
    title,
    ['Commit', 'Root', 'Duration', 'Components', 'Top component', 'Top component ms', 'Updater'],
    rows.map((row) => [
      `#${row.commit}`,
      row.root,
      ms(row.duration),
      int(row.components),
      wrap(row.topComponent),
      ms(row.topComponentMs),
      detail(row.updater),
    ]),
  );
}

function rootsTable(rows) {
  return table(
    'Roots',
    ['Root', 'Root ID', 'Commits', 'Snapshots', 'Total duration', 'Slowest commit'],
    rows.map((row) => [
      row.name,
      row.id,
      int(row.commits),
      int(row.snapshots),
      ms(row.totalDuration),
      `#${row.maxCommitIndex} · ${ms(row.maxCommit)}`,
    ]),
  );
}

function table(title, headings, rows) {
  const head = headings.map((heading) => `<th>${escapeHtml(heading)}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${row.map((cell) => renderCell(cell)).join('')}</tr>`)
    .join('');
  return `<h2>${escapeHtml(title)}</h2><div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderCell(cell) {
  if (cell && typeof cell === 'object') {
    return `<td class="${cell.className}">${escapeHtml(cell.value)}</td>`;
  }
  return `<td>${escapeHtml(cell)}</td>`;
}

function wrap(value) {
  return { className: 'wrap', value };
}

function detail(value) {
  return { className: 'detail', value };
}

function evidence(files) {
  if (files.length === 0) return '';
  const items = files
    .map((file) => {
      const image = isImagePath(file.label)
        ? `<div><img src="${escapeAttr(file.href)}" alt="${escapeAttr(file.label)}" /></div>`
        : '';
      return `<p><a href="${escapeAttr(file.href)}">${escapeHtml(file.label)}</a></p>${image}`;
    })
    .join('');
  return `<h2>Evidence</h2><div class="evidence">${items}</div>`;
}

function top(rows, key, limit) {
  return [...rows].sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0)).slice(0, limit);
}

function ms(value) {
  return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}ms`;
}

function sec(value) {
  return `${(Number(value || 0) / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}s`;
}

function int(value) {
  return Number(value || 0).toLocaleString();
}

function relativeUrl(outputPath, targetPath) {
  const relative = path.relative(path.dirname(path.resolve(outputPath)), path.resolve(targetPath));
  return encodeURI(relative.split(path.sep).join('/'));
}

function isImagePath(filePath) {
  return /\.(?:png|jpe?g|gif|webp|svg)$/i.test(filePath);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

try {
  const { inputPath, outputPath, options } = parseArgs(process.argv.slice(2));
  const profile = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const report = summarizeProfile(profile);
  const html = renderReport(report, {
    title: options.title,
    limit: options.limit,
    sourceLabel: path.basename(inputPath),
    sourceHref: relativeUrl(outputPath, inputPath),
    evidence: options.evidence.map((filePath) => ({
      label: path.basename(filePath),
      href: relativeUrl(outputPath, filePath),
    })),
  });

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, html);
  console.log(`Wrote ${outputPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
