import path from 'node:path';
import type { ResolvedProfile } from './platform-profiles.ts';

// A legacy-form batch step: maps through the exact documented CLI grammar.
// `flags` uses internal CliFlags field names (e.g. snapshotInteractiveOnly).
export type BatchStepSpec = {
  command: string;
  positionals?: string[];
  flags?: Record<string, unknown>;
};

type ScenarioStepBase = {
  label: string;
  command: string;
  // When set, the harness runs an untimed `open --relaunch` (reset to root, top of list)
  // before timing this step. Used for steps whose precondition is a clean root, since
  // earlier commands (find/is, search) leave the list scrolled or in a different surface.
  freshRoot?: boolean;
};

// Discriminated on execMode so the invoker gets the right payload without `!`/`?? []`:
// standalone carries full CLI args; batch carries one legacy batch step.
export type ScenarioStep =
  | (ScenarioStepBase & { execMode: 'standalone'; args: string[] })
  | (ScenarioStepBase & { execMode: 'batch'; step: BatchStepSpec; isSnapshot?: boolean });

export type StepContext = { artifactsDir: string };

function std(label: string, command: string, args: string[]): ScenarioStep {
  return { label, command, execMode: 'standalone', args };
}

function bat(
  label: string,
  command: string,
  step: BatchStepSpec,
  opts: { isSnapshot?: boolean; freshRoot?: boolean } = {},
): ScenarioStep {
  return { label, command, execMode: 'batch' as const, step, ...opts };
}

// One ordered pass over Settings. The harness repeats this N (+warmup) times;
// the leading `open --relaunch` resets the app to its root each round, so every
// round starts from a known state while commands run in their natural order.
export function buildSettingsTour(p: ResolvedProfile, ctx: StepContext): ScenarioStep[] {
  const s = p.selectors;
  const shot = path.join(ctx.artifactsDir, 'shot.png');
  const rec = path.join(ctx.artifactsDir, 'rec.mp4');
  const trace = path.join(ctx.artifactsDir, 'trace.log');

  // Text entry differs per platform: iOS fills the root search field directly (focusing it
  // first can hang); Android must open the search screen before an editable field exists.
  const textEntry: ScenarioStep[] = p.selectors.searchEditableAtRoot
    ? [
        // iOS: editable search field exists at root; fill it directly (freshRoot resets scroll).
        bat('fill search', 'fill', { command: 'fill', positionals: [s.searchFieldEditable, 'general'] }, { freshRoot: true }),
        bat('type', 'type', { command: 'type', positionals: ['wifi'] }),
        bat('get editable text', 'get', { command: 'get', positionals: ['text', s.searchFieldEditable] }),
      ]
    : [
        // Android: tap the search entry first to reveal the editable, then type/fill it.
        bat('press search field', 'press', { command: 'press', positionals: [s.searchField] }, { freshRoot: true }),
        bat('type', 'type', { command: 'type', positionals: ['wifi'] }),
        bat('fill search', 'fill', { command: 'fill', positionals: [s.searchFieldEditable, 'general'] }),
        bat('get editable text', 'get', { command: 'get', positionals: ['text', s.searchFieldEditable] }),
      ];

  return [
    // --- reset to root via relaunch ---
    std('open (relaunch → root)', 'open', ['open', p.appTarget, '--relaunch']),

    // --- reads on the root tree (snapshots first; anchor label is visible here) ---
    bat('snapshot -i (root)', 'snapshot', { command: 'snapshot', flags: { snapshotInteractiveOnly: true } }, { isSnapshot: true }),
    bat('snapshot (root)', 'snapshot', { command: 'snapshot' }, { isSnapshot: true }),

    // --- navigate into a sub-screen from a fresh root (freshRoot resets scroll so the
    //     deep-screen row is in view), read it, then return ---
    bat('press → deep screen', 'press', { command: 'press', positionals: [s.deepScreen] }, { freshRoot: true }),
    bat('snapshot (deep)', 'snapshot', { command: 'snapshot' }, { isSnapshot: true }),
    bat('snapshot -i (deep)', 'snapshot', { command: 'snapshot', flags: { snapshotInteractiveOnly: true } }, { isSnapshot: true }),
    bat('back', 'back', { command: 'back' }),

    // --- targeted reads against the visible anchor (freshRoot so the anchor is on screen) ---
    bat('wait text', 'wait', { command: 'wait', positionals: ['text', s.anchorText, '3000'] }, { freshRoot: true }),
    bat('find', 'find', { command: 'find', positionals: [s.anchorText] }),
    bat('get text', 'get', { command: 'get', positionals: ['text', s.anchorLabel] }),
    bat('is visible', 'is', { command: 'is', positionals: ['visible', s.anchorLabel] }),

    // --- text entry (platform-specific order; see textEntry above) then scroll results ---
    ...textEntry,
    bat('scroll down', 'scroll', { command: 'scroll', positionals: ['down'] }),

    // --- artifact-producing commands; record brackets the rest so the clip has >1s of
    //     footage (an instant start→stop makes simctl recordVideo fail to finalize) ---
    std('record start', 'record', ['record', 'start', rec, '--hide-touches']),
    bat('screenshot', 'screenshot', { command: 'screenshot', positionals: [shot] }),
    bat('logs mark', 'logs', { command: 'logs', positionals: ['mark', 'perf-mark'] }),
    bat('logs clear', 'logs', { command: 'logs', positionals: ['clear'] }),
    std('trace start', 'trace', ['trace', 'start', trace]),
    std('trace stop', 'trace', ['trace', 'stop']),
    bat('perf', 'perf', { command: 'perf' }),
    std('record stop', 'record', ['record', 'stop']),
  ];
}
