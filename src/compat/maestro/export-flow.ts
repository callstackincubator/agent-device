import type { SessionAction } from '../../daemon/types.ts';
import { parseSelectorChain, type Selector } from '../../daemon/selectors.ts';
import type { SelectorTerm } from '../../utils/selectors-parse.ts';
import { AppError } from '../../utils/errors.ts';
import {
  parseReplayScriptDetailed,
  readReplayScriptMetadata,
  type ReplayScriptMetadata,
} from '../../replay/script.ts';
import { stringifyMaestroYamlDocuments } from './flow-yaml.ts';
import { formatMaestroPoint } from './points.ts';
import type { MaestroCommand, MaestroFlowConfig } from './types.ts';

export type MaestroExportWarning = {
  line: number;
  action: string;
  message: string;
};

export type MaestroExportResult = {
  yaml: string;
  warnings: MaestroExportWarning[];
};

type MaestroExportConfig = Pick<MaestroFlowConfig, 'appId' | 'env'>;

type ExportContext = {
  config: MaestroExportConfig;
  warnings: MaestroExportWarning[];
  unsupported: MaestroExportWarning[];
};

type ConvertedAction =
  | { kind: 'commands'; commands: MaestroCommand[]; warnings?: string[] }
  | { kind: 'config'; appId: string; commands: MaestroCommand[]; warnings?: string[] }
  | { kind: 'unsupported'; message: string };

const TEXT_SELECTOR_KEYS = new Set(['id', 'text', 'label']);
const STATE_SELECTOR_KEYS = new Set(['enabled', 'selected']);

export function exportReplayScriptToMaestro(script: string): MaestroExportResult {
  const parsed = parseReplayScriptDetailed(script);
  return exportReplayActionsToMaestro(parsed.actions, {
    actionLines: parsed.actionLines,
    metadata: readReplayScriptMetadata(script),
  });
}

export function exportReplayActionsToMaestro(
  actions: SessionAction[],
  options: {
    actionLines?: number[];
    metadata?: ReplayScriptMetadata;
  } = {},
): MaestroExportResult {
  const context: ExportContext = {
    config: buildInitialConfig(options.metadata),
    warnings: [],
    unsupported: [],
  };
  const commands: MaestroCommand[] = [];

  for (const [index, action] of actions.entries()) {
    const line = options.actionLines?.[index] ?? index + 1;
    const converted = convertAction(action);
    switch (converted.kind) {
      case 'commands':
        commands.push(...converted.commands);
        appendWarnings(context, converted.warnings, action, line);
        break;
      case 'config':
        assignAppId(context, converted.appId, action, line);
        commands.push(...converted.commands);
        appendWarnings(context, converted.warnings, action, line);
        break;
      case 'unsupported':
        context.unsupported.push({
          line,
          action: formatActionForMessage(action),
          message: converted.message,
        });
        break;
    }
  }

  if (context.unsupported.length > 0) {
    throw new AppError(
      'INVALID_ARGS',
      `Cannot export replay to Maestro YAML: unsupported .ad action ${formatUnsupportedList(
        context.unsupported,
      )}.`,
      { unsupported: context.unsupported },
    );
  }

  return {
    yaml: formatMaestroYaml(context.config, commands),
    warnings: context.warnings,
  };
}

function buildInitialConfig(metadata: ReplayScriptMetadata | undefined): MaestroExportConfig {
  return metadata?.env && Object.keys(metadata.env).length > 0 ? { env: metadata.env } : {};
}

function convertAction(action: SessionAction): ConvertedAction {
  switch (action.command) {
    case 'open':
      return convertOpenAction(action);
    case 'click':
    case 'press':
      return convertClickAction(action);
    case 'longpress':
      return convertLongPressAction(action);
    case 'fill':
      return convertFillAction(action);
    case 'type':
      return convertTypeAction(action);
    case 'keyboard':
      return convertKeyboardAction(action);
    case 'back':
      return { kind: 'commands', commands: ['back'] };
    case 'wait':
      return convertWaitAction(action);
    case 'find':
      return convertFindAction(action);
    case 'screenshot':
      return convertScreenshotAction(action);
    case 'scroll':
      return convertScrollAction(action);
    case 'swipe':
      return convertSwipeAction(action);
    default:
      return { kind: 'unsupported', message: `${action.command} has no Maestro equivalent` };
  }
}

function convertOpenAction(action: SessionAction): ConvertedAction {
  const [first, second] = action.positionals;
  if (!first) return { kind: 'unsupported', message: 'open requires an app id or URL' };

  if (isUrl(first)) {
    return { kind: 'commands', commands: [{ openLink: first }] };
  }

  const launchApp = buildLaunchAppCommand(action, first);
  if (second && isUrl(second)) {
    return { kind: 'config', appId: first, commands: [launchApp, { openLink: second }] };
  }
  if (second) {
    return { kind: 'unsupported', message: 'open with a non-URL second argument is unsupported' };
  }
  return { kind: 'config', appId: first, commands: [launchApp] };
}

function buildLaunchAppCommand(action: SessionAction, appId: string): MaestroCommand {
  const launchArgs = action.flags?.launchArgs;
  const hasOptions =
    action.flags?.relaunch === true ||
    action.flags?.clearAppState === true ||
    (Array.isArray(launchArgs) && launchArgs.length > 0);
  if (!hasOptions) return 'launchApp';
  return {
    launchApp: {
      appId,
      ...(action.flags?.relaunch === true ? { stopApp: true } : {}),
      ...(action.flags?.clearAppState === true ? { clearState: true } : {}),
      ...(Array.isArray(launchArgs) && launchArgs.length > 0
        ? { launchArguments: launchArgs }
        : {}),
    },
  };
}

function convertClickAction(action: SessionAction): ConvertedAction {
  const [first, second] = action.positionals;
  if (!first) return { kind: 'unsupported', message: `${action.command} requires a target` };
  const tapTarget = readTapTarget(first, second);
  if (!tapTarget) return { kind: 'unsupported', message: 'tap target is not Maestro-compatible' };

  const tapOptions = readRepeatedTapOptions(action);
  if (!tapOptions.ok) return { kind: 'unsupported', message: tapOptions.message };

  if (action.flags?.doubleTap === true) {
    return { kind: 'commands', commands: [{ doubleTapOn: tapTarget }] };
  }
  if (typeof action.flags?.holdMs === 'number') {
    return { kind: 'commands', commands: [{ longPressOn: tapTarget }] };
  }

  return { kind: 'commands', commands: [withTapOptions(tapTarget, tapOptions.options)] };
}

function convertLongPressAction(action: SessionAction): ConvertedAction {
  const [first, second] = action.positionals;
  if (!first) return { kind: 'unsupported', message: 'longpress requires a target' };
  const target = readTapTarget(first, second);
  if (!target)
    return { kind: 'unsupported', message: 'longpress target is not Maestro-compatible' };
  return { kind: 'commands', commands: [{ longPressOn: target }] };
}

function convertFillAction(action: SessionAction): ConvertedAction {
  const [target, text] = action.positionals;
  if (!target || text === undefined) {
    return { kind: 'unsupported', message: 'fill requires a target and text' };
  }
  const tapTarget = readTapTarget(target);
  if (!tapTarget) return { kind: 'unsupported', message: 'fill target is not Maestro-compatible' };
  return {
    kind: 'commands',
    commands: [{ tapOn: tapTarget }, { inputText: text }],
    warnings: [
      'fill exports as tapOn + inputText; Maestro may append text instead of replacing existing field contents',
    ],
  };
}

function convertTypeAction(action: SessionAction): ConvertedAction {
  const [text] = action.positionals;
  if (text === undefined) return { kind: 'unsupported', message: 'type requires text' };
  const eraseCount = readBackspaceCount(text);
  if (eraseCount !== null) return { kind: 'commands', commands: [{ eraseText: eraseCount }] };
  return { kind: 'commands', commands: [{ inputText: text }] };
}

function convertKeyboardAction(action: SessionAction): ConvertedAction {
  const [subcommand] = action.positionals;
  if (subcommand === 'dismiss') return { kind: 'commands', commands: ['hideKeyboard'] };
  if (subcommand === 'enter' || subcommand === 'return') {
    return { kind: 'commands', commands: [{ pressKey: 'Enter' }] };
  }
  return { kind: 'unsupported', message: `keyboard ${subcommand ?? ''}`.trim() };
}

function convertWaitAction(action: SessionAction): ConvertedAction {
  const [first, second] = action.positionals;
  if (!first) return { kind: 'unsupported', message: 'wait requires a target or duration' };
  if (isNumber(first)) {
    return {
      kind: 'commands',
      commands: [{ waitForAnimationToEnd: { timeout: Number(first) } }],
      warnings: [
        'wait <ms> exports as waitForAnimationToEnd and may return before the full duration',
      ],
    };
  }
  if (first === 'text' && second) {
    return {
      kind: 'commands',
      commands: [{ extendedWaitUntil: { visible: second, timeout: readTimeout(action, 17_000) } }],
    };
  }
  const selector = selectorExpressionToMaestro(first);
  if (!selector) return { kind: 'unsupported', message: 'wait selector is not Maestro-compatible' };
  return {
    kind: 'commands',
    commands: [{ extendedWaitUntil: { visible: selector, timeout: readTimeout(action, 17_000) } }],
  };
}

function convertFindAction(action: SessionAction): ConvertedAction {
  const [kind, query, assertion] = action.positionals;
  if (kind !== 'text' || !query || !assertion) {
    return {
      kind: 'unsupported',
      message: 'only find text <query> exists|missing exports to Maestro',
    };
  }
  if (assertion === 'exists') return { kind: 'commands', commands: [{ assertVisible: query }] };
  if (assertion === 'missing' || assertion === 'not-exists') {
    return { kind: 'commands', commands: [{ assertNotVisible: query }] };
  }
  return { kind: 'unsupported', message: `find text assertion "${assertion}" is unsupported` };
}

function convertScreenshotAction(action: SessionAction): ConvertedAction {
  const [name] = action.positionals;
  if (!name) return { kind: 'unsupported', message: 'screenshot requires an output path' };
  return { kind: 'commands', commands: [{ takeScreenshot: name }] };
}

function convertScrollAction(action: SessionAction): ConvertedAction {
  const [direction] = action.positionals;
  if (!direction || direction === 'down') return { kind: 'commands', commands: ['scroll'] };
  return { kind: 'unsupported', message: `scroll ${direction} is not exported yet` };
}

function convertSwipeAction(action: SessionAction): ConvertedAction {
  const [x1, y1, x2, y2, duration] = action.positionals;
  if (!isNumber(x1) || !isNumber(y1) || !isNumber(x2) || !isNumber(y2)) {
    return { kind: 'unsupported', message: 'only coordinate swipe exports to Maestro' };
  }
  const swipe = {
    start: formatMaestroPoint(x1, y1),
    end: formatMaestroPoint(x2, y2),
    ...(duration && isNumber(duration) ? { duration: Number(duration) } : {}),
  };
  const count = action.flags?.count ?? 1;
  if (!Number.isInteger(count) || count < 1) {
    return { kind: 'unsupported', message: 'swipe count must be a positive integer' };
  }
  if (action.flags?.pauseMs !== undefined)
    return { kind: 'unsupported', message: 'swipe --pause-ms has no Maestro equivalent' };
  if (action.flags?.pattern && action.flags.pattern !== 'one-way') {
    return { kind: 'unsupported', message: 'swipe ping-pong pattern has no Maestro equivalent' };
  }
  return {
    kind: 'commands',
    commands: Array.from({ length: count }, () => ({ swipe })),
  };
}

function readTapTarget(first: string, second?: string): unknown | null {
  if (isNumber(first) && isNumber(second)) return { point: formatMaestroPoint(first, second) };
  if (first.startsWith('@')) return null;
  return selectorExpressionToMaestro(first);
}

function selectorExpressionToMaestro(expression: string): unknown | null {
  let chain: ReturnType<typeof parseSelectorChain>;
  try {
    chain = parseSelectorChain(expression);
  } catch {
    return expression.includes('=') || expression.includes('||') ? null : expression;
  }
  const fallbackText = readFallbackTextSelector(chain.selectors);
  if (fallbackText !== null) return fallbackText;
  if (chain.selectors.length !== 1) return null;
  return selectorToMaestro(chain.selectors[0]!);
}

function readFallbackTextSelector(selectors: Selector[]): string | null {
  if (selectors.length <= 1) return null;
  const values = selectors.flatMap((selector) =>
    selector.terms.length === 1 && TEXT_SELECTOR_KEYS.has(selector.terms[0]!.key)
      ? [selector.terms[0]!.value]
      : [],
  );
  if (values.length !== selectors.length || values.length === 0) return null;
  const first = values[0];
  if (typeof first !== 'string') return null;
  return values.every((value) => value === first) ? first : null;
}

function selectorToMaestro(selector: Selector): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};
  for (const term of selector.terms) {
    if (!appendSelectorTerm(result, term)) return null;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function appendSelectorTerm(result: Record<string, unknown>, term: SelectorTerm): boolean {
  if (TEXT_SELECTOR_KEYS.has(term.key)) {
    if (typeof term.value !== 'string' || result.id || result.text || result.label) return false;
    result[term.key] = term.value;
    return true;
  }
  if (STATE_SELECTOR_KEYS.has(term.key)) {
    if (typeof term.value !== 'boolean') return false;
    result[term.key] = term.value;
    return true;
  }
  return false;
}

function readRepeatedTapOptions(
  action: SessionAction,
): { ok: true; options: Record<string, unknown> } | { ok: false; message: string } {
  const options: Record<string, unknown> = {};
  if (typeof action.flags?.count === 'number' && action.flags.count > 1) {
    options.repeat = action.flags.count;
  }
  if (typeof action.flags?.intervalMs === 'number' && action.flags.intervalMs > 0) {
    options.delay = action.flags.intervalMs;
  }
  if (action.flags?.jitterPx !== undefined) {
    return { ok: false, message: 'tap --jitter-px has no Maestro equivalent' };
  }
  if (action.flags?.clickButton && action.flags.clickButton !== 'primary') {
    return {
      ok: false,
      message: `tap --button ${action.flags.clickButton} has no Maestro equivalent`,
    };
  }
  return { ok: true, options };
}

function withTapOptions(target: unknown, options: Record<string, unknown>): MaestroCommand {
  if (Object.keys(options).length === 0) return { tapOn: target };
  if (typeof target === 'string') return { tapOn: { text: target, ...options } };
  if (target && typeof target === 'object' && !Array.isArray(target)) {
    return { tapOn: { ...(target as Record<string, unknown>), ...options } };
  }
  return { tapOn: target };
}

function assignAppId(
  context: ExportContext,
  appId: string,
  action: SessionAction,
  line: number,
): void {
  if (!context.config.appId) {
    context.config.appId = appId;
    return;
  }
  if (context.config.appId === appId) return;
  context.unsupported.push({
    line,
    action: formatActionForMessage(action),
    message:
      `multiple app ids cannot be represented in one Maestro config ` +
      `(${context.config.appId} vs ${appId})`,
  });
}

function readBackspaceCount(text: string): number | null {
  if (text.length === 0) return null;
  if (![...text].every((char) => char === '\b')) return null;
  return text.length;
}

function appendWarnings(
  context: ExportContext,
  warnings: string[] | undefined,
  action: SessionAction,
  line: number,
): void {
  for (const message of warnings ?? []) {
    context.warnings.push({
      line,
      action: formatActionForMessage(action),
      message,
    });
  }
}

function readTimeout(action: SessionAction, fallback: number): number {
  const candidate = action.positionals.at(-1);
  return candidate && isNumber(candidate) ? Number(candidate) : fallback;
}

function formatMaestroYaml(config: MaestroExportConfig, commands: MaestroCommand[]): string {
  const hasConfig = Object.keys(config).length > 0;
  const docs: unknown[] = hasConfig ? [config, commands] : [commands];
  return stringifyMaestroYamlDocuments(docs);
}

function formatUnsupportedList(entries: MaestroExportWarning[]): string {
  return entries
    .map((entry) => `line ${entry.line} (${entry.action}): ${entry.message}`)
    .join('; ');
}

function formatActionForMessage(action: SessionAction): string {
  return [action.command, ...(action.positionals ?? [])].join(' ').trim();
}

function isUrl(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value);
}

function isNumber(value: string | undefined): value is string {
  return value !== undefined && Number.isFinite(Number(value));
}
