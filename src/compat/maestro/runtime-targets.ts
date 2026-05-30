import type { Platform } from '../../utils/device.ts';
import type { Rect, SnapshotNode, SnapshotState } from '../../utils/snapshot.ts';
import { parseSelectorChain } from '../../daemon/selectors.ts';
import { matchesSelector } from '../../daemon/selectors-match.ts';
import { evaluateIsPredicate } from '../../utils/selector-is-predicates.ts';
import { normalizeText } from '../../utils/finders.ts';
import { extractNodeText, normalizeType } from '../../utils/snapshot-processing.ts';
import type { TouchReferenceFrame } from '../../daemon/touch-reference-frame.ts';
import type { DaemonRequest } from '../../daemon/types.ts';
import type { Selector, SelectorTerm } from '../../daemon/selectors-parse.ts';
import { detectReactNativeOverlay } from '../../commands/react-native/overlay.ts';

const MAESTRO_TAP_TARGET_TYPE_RANK = new Map([
  ['button', 0],
  ['link', 0],
  ['textfield', 0],
  ['textview', 0],
  ['searchfield', 0],
  ['switch', 0],
  ['slider', 0],
  ['cell', 1],
  ['statictext', 2],
]);

export type MaestroTapOnOptions = {
  childOf?: string;
  index?: number;
};

export type MaestroSnapshotTarget = {
  node: SnapshotNode;
  rect: Rect;
  frame?: TouchReferenceFrame;
};

type MaestroResolvedSnapshotMatch = {
  node: SnapshotNode;
  rect: Rect;
  inheritedRect: boolean;
};

type MaestroMatchResolutionOptions = {
  promoteTapTarget?: boolean;
};

type ReactNativeOverlayFilterResult = {
  matches: SnapshotNode[];
  blockedByReactNativeOverlay: boolean;
};

type SnapshotNodeByIndex = Map<number, SnapshotNode>;

type MaestroMatchWithScreenContainer = {
  candidate: MaestroResolvedSnapshotMatch;
  container: SnapshotNode & { rect: Rect };
};

export function resolveMaestroNodeFromSnapshot(
  snapshot: SnapshotState,
  selector: string,
  options: MaestroTapOnOptions,
  platform: Platform,
  frame: TouchReferenceFrame | undefined,
  resolutionOptions: MaestroMatchResolutionOptions = {},
): { ok: true; node: SnapshotNode; rect: Rect } | { ok: false; message: string } {
  let matches = findMaestroSelectorMatches(snapshot, selector, platform);
  if (options.childOf) {
    const parents = findMaestroSelectorMatches(snapshot, options.childOf, platform);
    if (parents.length === 0) {
      return { ok: false, message: `Maestro childOf parent did not match: ${options.childOf}` };
    }
    const nodeByIndex = buildSnapshotNodeByIndex(snapshot.nodes);
    matches = matches.filter((node) =>
      parents.some((parent) =>
        isDescendantOfSnapshotNode(snapshot.nodes, node, parent, nodeByIndex),
      ),
    );
  }
  const filteredMatches = filterReactNativeOverlayBlockedMatches(snapshot.nodes, matches);

  const target = selectMaestroSnapshotMatch(
    snapshot.nodes,
    filteredMatches.matches,
    options.index,
    extractMaestroVisibleTextQuery(selector),
    frame,
    false,
    resolutionOptions.promoteTapTarget,
  );
  if (!target) {
    const index = options.index ?? 0;
    return {
      ok: false,
      message: filteredMatches.blockedByReactNativeOverlay
        ? `Maestro selector matched ${matches.length} element(s), but React Native overlay is covering app content: ${selector}`
        : `Maestro selector did not match index ${index}: ${selector}`,
    };
  }
  return { ok: true, node: target.node, rect: target.rect };
}

export function resolveMaestroFuzzyTextNodeFromSnapshot(
  snapshot: SnapshotState,
  query: string,
  frame: TouchReferenceFrame | undefined,
  resolutionOptions: MaestroMatchResolutionOptions = {},
): { ok: true; node: SnapshotNode; rect: Rect } | { ok: false; message: string } {
  const matches = findMaestroFuzzyTextMatches(snapshot, query);
  const target = selectMaestroSnapshotMatch(
    snapshot.nodes,
    matches,
    undefined,
    query,
    frame,
    false,
    resolutionOptions.promoteTapTarget,
  );
  if (!target) {
    return { ok: false, message: `Maestro fuzzy text did not match: ${query}` };
  }
  return { ok: true, node: target.node, rect: target.rect };
}

export function resolveVisibleMaestroNodeFromSnapshot(
  snapshot: SnapshotState,
  selector: string,
  platform: Platform,
  frame: TouchReferenceFrame | undefined,
): { ok: true; node: SnapshotNode; rect: Rect; matches: number } | { ok: false; message: string } {
  const matches = findMaestroSelectorMatches(snapshot, selector, platform);
  const visibleMatchesResult = filterVisibleMaestroMatches({
    nodes: snapshot.nodes,
    matches,
    platform,
  });
  const target = selectMaestroSnapshotMatch(
    snapshot.nodes,
    visibleMatchesResult.matches,
    undefined,
    extractMaestroVisibleTextQuery(selector),
    frame,
    true,
  );
  if (!target) {
    return {
      ok: false,
      message:
        matches.length > 0
          ? visibleMatchesResult.blockedByReactNativeOverlay
            ? `Maestro selector matched ${matches.length} element(s), but React Native overlay is covering app content: ${selector}`
            : `Maestro selector matched ${matches.length} element(s), but none were visible: ${selector}`
          : `Maestro selector did not match: ${selector}`,
    };
  }
  return {
    ok: true,
    node: target.node,
    rect: target.rect,
    matches: visibleMatchesResult.matches.length,
  };
}

function filterVisibleMaestroMatches(params: {
  nodes: SnapshotState['nodes'];
  matches: SnapshotNode[];
  platform: Platform;
}): { matches: SnapshotNode[]; blockedByReactNativeOverlay: boolean } {
  const visibleMatches = params.matches.filter(
    (node) =>
      evaluateIsPredicate({
        predicate: 'visible',
        node,
        nodes: params.nodes,
        platform: params.platform,
      }).pass,
  );
  const overlayFilter = filterReactNativeOverlayBlockedMatches(params.nodes, visibleMatches);
  return {
    matches: overlayFilter.matches,
    blockedByReactNativeOverlay: overlayFilter.blockedByReactNativeOverlay,
  };
}

function filterReactNativeOverlayBlockedMatches(
  nodes: SnapshotState['nodes'],
  matches: SnapshotNode[],
): ReactNativeOverlayFilterResult {
  const overlay = detectReactNativeOverlay(nodes);
  if (!overlay.detected) {
    return { matches, blockedByReactNativeOverlay: false };
  }
  if (!overlay.redBox) {
    return { matches, blockedByReactNativeOverlay: false };
  }
  const overlayNodeIndexes = new Set(
    [...overlay.dismissNodes, ...overlay.minimizeNodes, ...overlay.collapsedNodes].map(
      (node) => node.index,
    ),
  );
  const overlayMatches = matches.filter((node) => overlayNodeIndexes.has(node.index));
  return {
    matches: overlayMatches,
    blockedByReactNativeOverlay: matches.length > 0 && overlayMatches.length === 0,
  };
}

export function readMaestroSelectorPlatform(flags: DaemonRequest['flags']): Platform {
  return flags?.platform === 'android' ? 'android' : 'ios';
}

export function extractMaestroVisibleTextQuery(selectorExpression: string): string | null {
  const chain = parseSelectorChain(selectorExpression);
  const terms = chain.selectors.flatMap((selector) => selector.terms);
  if (terms.length === 0) return null;
  // Mixed selectors may encode more than a visible-text lookup, so they keep
  // the exact selector path instead of fuzzy text fallback.
  if (!terms.some((term) => term.key === 'label' || term.key === 'text')) return null;
  if (!terms.every((term) => ['label', 'text', 'id'].includes(term.key))) return null;
  const values = terms.map((term) => (typeof term.value === 'string' ? term.value : ''));
  const first = values[0];
  if (!first || !values.every((value) => value === first)) return null;
  return first;
}

function findMaestroSelectorMatches(
  snapshot: SnapshotState,
  selectorExpression: string,
  platform: Platform,
): SnapshotNode[] {
  const chain = parseSelectorChain(selectorExpression);
  for (const selector of chain.selectors) {
    const matches = snapshot.nodes.filter((node) =>
      matchesMaestroSelector(node, selector, platform),
    );
    if (matches.length > 0) return matches;
  }
  return [];
}

function findMaestroFuzzyTextMatches(snapshot: SnapshotState, query: string): SnapshotNode[] {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];
  const exact: SnapshotNode[] = [];
  const partial: SnapshotNode[] = [];
  for (const node of snapshot.nodes) {
    const values = [node.label, extractNodeText(node), node.identifier, node.value].filter(
      (value): value is string => Boolean(value),
    );
    const normalizedValues = values.map((value) => normalizeText(value));
    if (normalizedValues.some((value) => value === normalizedQuery)) {
      exact.push(node);
    } else if (normalizedValues.some((value) => value.includes(normalizedQuery))) {
      partial.push(node);
    }
  }
  return exact.length > 0 ? exact : partial;
}

function matchesMaestroSelector(
  node: SnapshotNode,
  selector: Selector,
  platform: Platform,
): boolean {
  if (matchesSelector(node, selector, platform)) return true;
  return selector.terms.every((term) => matchesMaestroTerm(node, term, platform));
}

function matchesMaestroTerm(node: SnapshotNode, term: SelectorTerm, platform: Platform): boolean {
  if (typeof term.value !== 'string' || !isMaestroRegexTextKey(term.key)) {
    return matchesSelector(node, { raw: term.key, terms: [term] }, platform);
  }
  const value = readMaestroTextTermValue(node, term.key);
  return textEqualsOrRegex(value, term.value);
}

function isMaestroRegexTextKey(key: SelectorTerm['key']): key is 'id' | 'label' | 'text' | 'value' {
  return key === 'id' || key === 'label' || key === 'text' || key === 'value';
}

function readMaestroTextTermValue(
  node: SnapshotNode,
  key: 'id' | 'label' | 'text' | 'value',
): string | undefined {
  if (key === 'id') return node.identifier;
  if (key === 'label') return node.label;
  if (key === 'value') return node.value;
  return extractNodeText(node);
}

function textEqualsOrRegex(value: string | undefined, query: string): boolean {
  const text = value ?? '';
  if (normalizeText(text) === normalizeText(query)) return true;
  try {
    return new RegExp(query).test(text);
  } catch {
    return false;
  }
}

function resolveNodeRect(
  nodes: SnapshotState['nodes'],
  node: SnapshotNode,
  nodeByIndex: SnapshotNodeByIndex,
): { rect: Rect; inherited: boolean } | null {
  if (node.rect && node.rect.width > 0 && node.rect.height > 0) {
    return { rect: node.rect, inherited: false };
  }
  if (node.rect) return null;
  const rect = resolveRectlessNodeAncestorRect(nodes, node, nodeByIndex);
  return rect ? { rect, inherited: true } : null;
}

function resolveRectlessNodeAncestorRect(
  nodes: SnapshotState['nodes'],
  node: SnapshotNode,
  nodeByIndex: SnapshotNodeByIndex,
): Rect | null {
  let current: SnapshotNode | undefined = node;
  while (typeof current.parentIndex === 'number') {
    current = nodeByIndex.get(current.parentIndex) ?? nodes[current.parentIndex];
    if (!current) return null;
    if (!current.rect) continue;
    return current.rect.width > 0 && current.rect.height > 0 ? current.rect : null;
  }
  return null;
}

function selectMaestroSnapshotMatch(
  nodes: SnapshotState['nodes'],
  matches: SnapshotNode[],
  index: number | undefined,
  visibleTextQuery: string | null,
  frame: TouchReferenceFrame | undefined,
  requireOnScreen = false,
  promoteTapTarget = false,
): { node: SnapshotNode; rect: Rect } | null {
  const nodeByIndex = buildSnapshotNodeByIndex(nodes);
  const candidates = resolveMaestroSnapshotMatchCandidates(
    nodes,
    matches,
    nodeByIndex,
    visibleTextQuery,
    index,
    frame,
    requireOnScreen,
  );
  const target = chooseMaestroSnapshotMatch(nodes, candidates, index, visibleTextQuery, promoteTapTarget);
  return promoteMaestroSnapshotMatch(nodes, target, nodeByIndex, promoteTapTarget, frame);
}

function resolveMaestroSnapshotMatchCandidates(
  nodes: SnapshotState['nodes'],
  matches: SnapshotNode[],
  nodeByIndex: SnapshotNodeByIndex,
  visibleTextQuery: string | null,
  index: number | undefined,
  frame: TouchReferenceFrame | undefined,
  requireOnScreen: boolean,
): MaestroResolvedSnapshotMatch[] {
  const resolved = matches
    .map((node) => resolveMaestroSnapshotMatch(nodes, node, nodeByIndex))
    .filter((candidate): candidate is MaestroResolvedSnapshotMatch => Boolean(candidate));
  const concrete = resolved.filter((candidate) => !candidate.inheritedRect);
  const candidates = concrete.length > 0 ? concrete : resolved;
  if (!visibleTextQuery || index !== undefined) return resolved;
  return preferOnScreenMatches(candidates, frame, requireOnScreen);
}

function resolveMaestroSnapshotMatch(
  nodes: SnapshotState['nodes'],
  node: SnapshotNode,
  nodeByIndex: SnapshotNodeByIndex,
): MaestroResolvedSnapshotMatch | null {
  const match = resolveNodeRect(nodes, node, nodeByIndex);
  return match ? { node, rect: match.rect, inheritedRect: match.inherited } : null;
}

function chooseMaestroSnapshotMatch(
  nodes: SnapshotState['nodes'],
  candidates: MaestroResolvedSnapshotMatch[],
  index: number | undefined,
  visibleTextQuery: string | null,
  promoteTapTarget: boolean,
): MaestroResolvedSnapshotMatch | null {
  if (index !== undefined) return candidates[index] ?? null;
  const best = selectPreferredMaestroSnapshotMatch(
    nodes,
    candidates,
    visibleTextQuery,
    promoteTapTarget,
  );
  if (!shouldInferMaestroTabSlot(best, visibleTextQuery, promoteTapTarget)) return best;
  return inferMaestroMissingTabSlotMatch(nodes, best, visibleTextQuery!) ?? best;
}

function selectPreferredMaestroSnapshotMatch(
  nodes: SnapshotState['nodes'],
  candidates: MaestroResolvedSnapshotMatch[],
  visibleTextQuery: string | null,
  promoteTapTarget: boolean,
): MaestroResolvedSnapshotMatch | null {
  if (!promoteTapTarget || !visibleTextQuery) {
    return selectBestMaestroSnapshotMatch(nodes, candidates, visibleTextQuery);
  }
  return (
    selectLocalizedMaestroVisibleTextMatch(nodes, candidates, visibleTextQuery) ??
    selectBestMaestroSnapshotMatch(nodes, candidates, visibleTextQuery)
  );
}

function shouldInferMaestroTabSlot(
  match: MaestroResolvedSnapshotMatch | null,
  visibleTextQuery: string | null,
  promoteTapTarget: boolean,
): match is MaestroResolvedSnapshotMatch {
  return Boolean(promoteTapTarget && visibleTextQuery && match);
}

function selectBestMaestroSnapshotMatch(
  nodes: SnapshotState['nodes'],
  candidates: MaestroResolvedSnapshotMatch[],
  visibleTextQuery: string | null,
): MaestroResolvedSnapshotMatch | null {
  const foregroundCandidates = preferForegroundContainerDuplicateMatches(
    nodes,
    candidates,
    visibleTextQuery,
  );
  return (
    foregroundCandidates.sort((left, right) =>
      compareMaestroSnapshotMatches(left, right, visibleTextQuery),
    )[0] ?? null
  );
}

function selectLocalizedMaestroVisibleTextMatch(
  nodes: SnapshotState['nodes'],
  candidates: MaestroResolvedSnapshotMatch[],
  query: string,
): MaestroResolvedSnapshotMatch | null {
  const exactMatches = candidates.filter(
    (candidate) => maestroVisibleTextMatchRank(candidate.node, query) === 0,
  );
  if (exactMatches.length >= 2) {
    const localizedExact = selectLocalizedMaestroVisibleTextMatchFromCandidates(
      nodes,
      exactMatches,
      query,
    );
    if (localizedExact) return localizedExact;
  }

  const normalizedMatches = candidates.filter(
    (candidate) => maestroVisibleTextMatchRank(candidate.node, query) === 1,
  );
  if (exactMatches.length > 0 || normalizedMatches.length < 2) return null;

  return selectLocalizedMaestroVisibleTextMatchFromCandidates(nodes, normalizedMatches, query);
}

function selectLocalizedMaestroVisibleTextMatchFromCandidates(
  nodes: SnapshotState['nodes'],
  candidates: MaestroResolvedSnapshotMatch[],
  query: string,
): MaestroResolvedSnapshotMatch | null {
  const nodeByIndex = buildSnapshotNodeByIndex(nodes);
  const localized = candidates.filter(
    (candidate) =>
      isLocalizedMaestroVisibleTextCandidate(candidate) &&
      candidates.some((container) =>
        isMaestroVisibleTextContainerForCandidate(nodes, container, candidate, nodeByIndex),
      ),
  );

  return selectBestMaestroSnapshotMatch(nodes, localized, query);
}

function preferForegroundContainerDuplicateMatches(
  nodes: SnapshotState['nodes'],
  candidates: MaestroResolvedSnapshotMatch[],
  visibleTextQuery: string | null,
): MaestroResolvedSnapshotMatch[] {
  if (!visibleTextQuery || candidates.length < 2) return candidates;
  const exact = candidates.filter(
    (candidate) => maestroVisibleTextMatchRank(candidate.node, visibleTextQuery) === 0,
  );
  if (exact.length < 2) return candidates;

  const nodeByIndex = buildSnapshotNodeByIndex(nodes);
  const withContainers = exact
    .map((candidate) => ({
      candidate,
      container: findMaestroScreenContainer(nodes, candidate.node, nodeByIndex),
    }))
    .filter((entry): entry is MaestroMatchWithScreenContainer => Boolean(entry.container));
  if (withContainers.length < 2 || withContainers.length !== exact.length) return candidates;

  const overlapping = withContainers.filter((entry) =>
    hasOverlappingScreenContainer(entry, withContainers),
  );
  if (overlapping.length < 2) return candidates;

  // UIAutomator reports foreground transparent-stack screens later in the
  // hierarchy while preserving both screens. Prefer the later overlapping
  // screen only for exact duplicate text, so ordinary duplicate rows keep
  // Maestro's read-order behavior.
  const foregroundContainerIndex = Math.max(...overlapping.map((entry) => entry.container.index));
  const foreground = overlapping
    .filter((entry) => entry.container.index === foregroundContainerIndex)
    .map((entry) => entry.candidate);
  return foreground.length > 0 ? foreground : candidates;
}

function hasOverlappingScreenContainer(
  entry: MaestroMatchWithScreenContainer,
  candidates: MaestroMatchWithScreenContainer[],
): boolean {
  return candidates.some(
    (other) =>
      other !== entry &&
      entry.container.index !== other.container.index &&
      rectOverlapRatio(entry.container.rect, other.container.rect) >= 0.6,
  );
}

function findMaestroScreenContainer(
  nodes: SnapshotState['nodes'],
  node: SnapshotNode,
  nodeByIndex: SnapshotNodeByIndex,
): (SnapshotNode & { rect: Rect }) | null {
  return findSnapshotAncestor(nodes, node, nodeByIndex, (ancestor) => {
    if (!ancestor.rect) return null;
    if (!isMaestroScreenContainerType(ancestor)) return null;
    if (ancestor.rect.width < 240 || ancestor.rect.height < 320) return null;
    return ancestor as SnapshotNode & { rect: Rect };
  });
}

function isMaestroScreenContainerType(node: SnapshotNode): boolean {
  const type = normalizeType(node.type ?? '');
  return type === 'scrollview' || type === 'scroll-area' || type === 'list';
}

function isLocalizedMaestroVisibleTextCandidate(match: MaestroResolvedSnapshotMatch): boolean {
  return (
    match.rect.width >= 16 &&
    match.rect.width <= 260 &&
    match.rect.height >= 24 &&
    match.rect.height <= 80
  );
}

function isMaestroVisibleTextContainerForCandidate(
  nodes: SnapshotState['nodes'],
  container: MaestroResolvedSnapshotMatch,
  candidate: MaestroResolvedSnapshotMatch,
  nodeByIndex: SnapshotNodeByIndex,
): boolean {
  if (container.node.index === candidate.node.index) return false;
  if (!rectContains(container.rect, candidate.rect)) return false;
  if (rectArea(container.rect) < rectArea(candidate.rect) * 2) return false;
  return isDescendantOfSnapshotNode(nodes, candidate.node, container.node, nodeByIndex);
}

function preferOnScreenMatches(
  matches: MaestroResolvedSnapshotMatch[],
  frame: TouchReferenceFrame | undefined,
  requireOnScreen: boolean,
): MaestroResolvedSnapshotMatch[] {
  const onScreen = matches.filter((match) => isRectOnScreen(match.rect, frame));
  if (requireOnScreen) return onScreen;
  return onScreen.length > 0 ? onScreen : matches;
}

function isRectOnScreen(rect: Rect, frame: TouchReferenceFrame | undefined): boolean {
  const maxX = frame?.referenceWidth ?? Number.POSITIVE_INFINITY;
  const maxY = frame?.referenceHeight ?? Number.POSITIVE_INFINITY;
  return rect.x < maxX && rect.y < maxY && rect.x + rect.width > 0 && rect.y + rect.height > 0;
}

function compareMaestroSnapshotMatches(
  left: MaestroResolvedSnapshotMatch,
  right: MaestroResolvedSnapshotMatch,
  visibleTextQuery: string | null,
): number {
  const priorityRank = compareMaestroSnapshotMatchPriority(left, right, visibleTextQuery);
  if (priorityRank !== 0) return priorityRank;

  if (!sameRoundedRect(left.rect, right.rect)) {
    return left.node.index - right.node.index;
  }

  const depthRank = (right.node.depth ?? 0) - (left.node.depth ?? 0);
  if (depthRank !== 0) return depthRank;

  // Android transparent stacks can expose both the background screen and the
  // foreground screen at the same coordinates. UIAutomator reports the
  // foreground duplicate later in the snapshot, which matches Maestro's
  // practical tap target for overlapping duplicates.
  return right.node.index - left.node.index;
}

function sameRoundedRect(left: Rect, right: Rect): boolean {
  return (
    Math.round(left.x) === Math.round(right.x) &&
    Math.round(left.y) === Math.round(right.y) &&
    Math.round(left.width) === Math.round(right.width) &&
    Math.round(left.height) === Math.round(right.height)
  );
}

function compareMaestroSnapshotMatchPriority(
  left: MaestroResolvedSnapshotMatch,
  right: MaestroResolvedSnapshotMatch,
  visibleTextQuery: string | null,
): number {
  if (visibleTextQuery) {
    const textRank =
      maestroVisibleTextMatchRank(left.node, visibleTextQuery) -
      maestroVisibleTextMatchRank(right.node, visibleTextQuery);
    if (textRank !== 0) return textRank;
  }

  const typeRank = maestroTapTargetTypeRank(left.node) - maestroTapTargetTypeRank(right.node);
  if (typeRank !== 0) return typeRank;

  const rectSourceRank = Number(left.inheritedRect) - Number(right.inheritedRect);
  if (rectSourceRank !== 0) return rectSourceRank;

  const areaRank =
    visibleTextQuery && maestroTapTargetTypeRank(left.node) === maestroTapTargetTypeRank(right.node)
      ? rectArea(right.rect) - rectArea(left.rect)
      : rectArea(left.rect) - rectArea(right.rect);
  if (areaRank !== 0) return areaRank;
  return 0;
}

function rectArea(rect: Rect): number {
  return rect.width * rect.height;
}

function maestroTapTargetTypeRank(node: SnapshotNode): number {
  return MAESTRO_TAP_TARGET_TYPE_RANK.get(normalizeType(node.type ?? '')) ?? 3;
}

function inferMaestroMissingTabSlotMatch(
  nodes: SnapshotState['nodes'],
  match: MaestroResolvedSnapshotMatch,
  query: string,
): MaestroResolvedSnapshotMatch | null {
  if (!isMaestroTabStripContainerMatch(match, query)) return null;
  const children = collectMaestroTabStripChildCandidates(nodes, match, query);
  if (children.length === 0) return null;
  const medianChildWidth = median(children.map((child) => child.rect.width));
  const allGaps = resolveHorizontalGaps(
    match.rect,
    children.map((child) => child.rect),
  );
  const gap = selectMaestroMissingSlotGap(match, query, allGaps, medianChildWidth);
  if (!gap) return null;
  return matchWithRect(match, gap);
}

function collectMaestroTabStripChildCandidates(
  nodes: SnapshotState['nodes'],
  match: MaestroResolvedSnapshotMatch,
  query: string,
): Array<SnapshotNode & { rect: Rect }> {
  return nodes
    .filter((node): node is SnapshotNode & { rect: Rect } => {
      return (
        node.parentIndex === match.node.index &&
        Boolean(node.rect) &&
        isMaestroTabStripChildCandidate(node as SnapshotNode & { rect: Rect }, match.rect, query)
      );
    })
    .sort((left, right) => left.rect.x - right.rect.x);
}

function selectMaestroMissingSlotGap(
  match: MaestroResolvedSnapshotMatch,
  query: string,
  gaps: Array<{ x: number; width: number }>,
  medianChildWidth: number,
): { x: number; width: number } | null {
  const plausibleGaps = gaps.filter((gap) => isPlausibleMissingTabSlot(gap.width, medianChildWidth));
  const leadingTextSlot = inferMaestroLeadingTextSlotGap(match, query, gaps);
  const hasPlausibleLeadingGap = plausibleGaps.some((gap) => isLeadingGap(match.rect, gap));
  if (leadingTextSlot && !hasPlausibleLeadingGap) return leadingTextSlot;
  if (plausibleGaps.length === 1) return plausibleGaps[0] ?? null;
  return leadingTextSlot;
}

function inferMaestroLeadingTextSlotGap(
  match: MaestroResolvedSnapshotMatch,
  query: string,
  gaps: Array<{ x: number; width: number }>,
): { x: number; width: number } | null {
  const leadingGap = gaps.find((gap) => Math.abs(gap.x - match.rect.x) < 1);
  const estimatedLabelWidth = Math.max(48, Math.min(220, query.length * 8 + 24));
  if (!isLeadingTextSlotCandidate(match, query, leadingGap, estimatedLabelWidth)) return null;
  return {
    x: match.rect.x,
    width: Math.min(estimatedLabelWidth, leadingGap.width),
  };
}

function isLeadingTextSlotCandidate(
  match: MaestroResolvedSnapshotMatch,
  query: string,
  gap: { x: number; width: number } | undefined,
  estimatedLabelWidth: number,
): gap is { x: number; width: number } {
  if (!gap) return false;
  return (
    normalizeType(match.node.type ?? '') === 'scrollview' &&
    maestroVisibleTextMatchRank(match.node, query) <= 1 &&
    match.rect.width >= 240 &&
    match.rect.height >= 32 &&
    match.rect.height <= 80 &&
    gap.width <= match.rect.width * 0.55 &&
    gap.width >= estimatedLabelWidth * 0.6
  );
}

function isLeadingGap(rect: Rect, gap: { x: number; width: number }): boolean {
  return Math.abs(gap.x - rect.x) < 1;
}

function matchWithRect(
  match: MaestroResolvedSnapshotMatch,
  gap: { x: number; width: number },
): MaestroResolvedSnapshotMatch {
  return {
    ...match,
    rect: {
      x: gap.x,
      y: match.rect.y,
      width: gap.width,
      height: match.rect.height,
    },
  };
}

function isMaestroTabStripContainerMatch(
  match: MaestroResolvedSnapshotMatch,
  query: string,
): boolean {
  const type = normalizeType(match.node.type ?? '');
  if (type !== 'other' && type !== 'scrollview' && type !== 'scroll-area') return false;
  if (match.rect.width < 120 || match.rect.height < 32 || match.rect.height > 80) return false;
  return maestroVisibleTextMatchRank(match.node, query) <= 1;
}

function isMaestroTabStripChildCandidate(
  node: SnapshotNode & { rect: Rect },
  container: Rect,
  query: string,
): boolean {
  const type = normalizeType(node.type ?? '');
  if (type !== 'button' && type !== 'cell' && type !== 'other') return false;
  if (maestroVisibleTextMatchRank(node, query) <= 1) return false;
  if (node.rect.width < 16 || node.rect.height < 16) return false;
  if (!rectContains(container, node.rect)) return false;
  return verticalOverlapRatio(container, node.rect) >= 0.5;
}

function resolveHorizontalGaps(
  container: Rect,
  occupied: Rect[],
): Array<{ x: number; width: number }> {
  const gaps: Array<{ x: number; width: number }> = [];
  let cursor = container.x;
  const containerRight = container.x + container.width;
  for (const rect of occupied) {
    const start = Math.max(container.x, rect.x);
    const end = Math.min(containerRight, rect.x + rect.width);
    if (start > cursor) gaps.push({ x: cursor, width: start - cursor });
    cursor = Math.max(cursor, end);
  }
  if (containerRight > cursor) gaps.push({ x: cursor, width: containerRight - cursor });
  return gaps;
}

function isPlausibleMissingTabSlot(gapWidth: number, medianChildWidth: number): boolean {
  if (gapWidth < 24 || medianChildWidth < 24) return false;
  return gapWidth >= medianChildWidth * 0.4 && gapWidth <= medianChildWidth * 1.6;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted[middle] ?? 0;
}

function verticalOverlapRatio(a: Rect, b: Rect): number {
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const overlap = Math.max(0, bottom - top);
  return overlap / Math.max(1, Math.min(a.height, b.height));
}

function promoteMaestroSnapshotMatch(
  nodes: SnapshotState['nodes'],
  match: MaestroResolvedSnapshotMatch | null,
  nodeByIndex: SnapshotNodeByIndex,
  promoteTapTarget: boolean,
  frame: TouchReferenceFrame | undefined,
): { node: SnapshotNode; rect: Rect } | null {
  if (!match) return null;
  if (!promoteTapTarget) {
    return { node: match.node, rect: match.rect };
  }
  const ancestor = findMaestroTapAncestor(nodes, match, nodeByIndex, frame);
  return ancestor ?? { node: match.node, rect: match.rect };
}

function findMaestroTapAncestor(
  nodes: SnapshotState['nodes'],
  match: MaestroResolvedSnapshotMatch,
  nodeByIndex: SnapshotNodeByIndex,
  frame: TouchReferenceFrame | undefined,
): { node: SnapshotNode; rect: Rect } | null {
  if (isActionableMaestroTapTarget(match.node)) return null;
  return findSnapshotAncestor(nodes, match.node, nodeByIndex, (ancestor) => {
    if (!isActionableMaestroTapTarget(ancestor)) return null;
    const ancestorRect = resolveNodeRect(nodes, ancestor, nodeByIndex);
    if (!ancestorRect || !isUsefulMaestroTapAncestorRect(match.rect, ancestorRect.rect, frame)) {
      return null;
    }
    return { node: ancestor, rect: ancestorRect.rect };
  });
}

function isActionableMaestroTapTarget(node: SnapshotNode): boolean {
  const type = normalizeType(node.type ?? '');
  return (
    node.hittable === true ||
    type === 'button' ||
    type === 'link' ||
    type === 'cell' ||
    type === 'textfield' ||
    type === 'searchfield' ||
    type === 'switch' ||
    type === 'slider'
  );
}

function isUsefulMaestroTapAncestorRect(
  matchRect: Rect,
  ancestorRect: Rect,
  frame: TouchReferenceFrame | undefined,
): boolean {
  if (!rectContains(ancestorRect, matchRect)) return false;
  const ancestorArea = rectArea(ancestorRect);
  const matchArea = rectArea(matchRect);
  // Keep promotion close to the matched label/id instead of jumping to a broad container.
  if (matchArea > 0 && ancestorArea > matchArea * 30) return false;
  if (frame) {
    const frameArea = frame.referenceWidth * frame.referenceHeight;
    // Full-screen ancestors are usually layout containers, not meaningful tap targets.
    if (frameArea > 0 && ancestorArea > frameArea * 0.5) return false;
  }
  return true;
}

function rectContains(container: Rect, child: Rect): boolean {
  return (
    child.x >= container.x &&
    child.y >= container.y &&
    child.x + child.width <= container.x + container.width &&
    child.y + child.height <= container.y + container.height
  );
}

function rectOverlapRatio(a: Rect, b: Rect): number {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const overlapArea = Math.max(0, right - left) * Math.max(0, bottom - top);
  return overlapArea / Math.max(1, Math.min(rectArea(a), rectArea(b)));
}

function maestroVisibleTextMatchRank(node: SnapshotNode, query: string): number {
  const values = [node.label, extractNodeText(node), node.identifier, node.value].filter(
    (value): value is string => Boolean(value),
  );
  if (values.some((value) => value === query)) return 0;
  if (values.some((value) => normalizeText(value) === normalizeText(query))) return 1;
  if (values.some((value) => textEqualsOrRegex(value, query))) return 2;
  return 3;
}

function isDescendantOfSnapshotNode(
  nodes: SnapshotState['nodes'],
  node: SnapshotNode,
  ancestor: SnapshotNode,
  nodeByIndex: SnapshotNodeByIndex,
): boolean {
  return Boolean(
    findSnapshotAncestor(nodes, node, nodeByIndex, (candidate) =>
      candidate === ancestor || candidate.index === ancestor.index ? candidate : null,
    ),
  );
}

function findSnapshotAncestor<T>(
  nodes: SnapshotState['nodes'],
  node: SnapshotNode,
  nodeByIndex: SnapshotNodeByIndex,
  resolve: (ancestor: SnapshotNode) => T | null,
): T | null {
  let current: SnapshotNode | undefined = node;
  while (typeof current.parentIndex === 'number') {
    current = nodeByIndex.get(current.parentIndex) ?? nodes[current.parentIndex];
    if (!current) return null;
    const result = resolve(current);
    if (result) return result;
  }
  return null;
}

function buildSnapshotNodeByIndex(nodes: SnapshotState['nodes']): SnapshotNodeByIndex {
  return new Map(nodes.map((candidate) => [candidate.index, candidate]));
}
