import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { evaluateIsPredicate, isSupportedPredicate } from '../is-predicates.ts';
import {
  findSelectorChainMatch,
  formatSelectorFailure,
  parseSelectorChain,
  splitIsSelectorArgs,
} from '../selectors.ts';
import type { DaemonResponse } from '../types.ts';
import type { InteractionHandlerParams } from './interaction-common.ts';
import { captureSnapshotForSession } from './interaction-snapshot.ts';
import { resolveSelectorTarget } from './interaction-selector.ts';

export async function handleIsCommand(params: InteractionHandlerParams): Promise<DaemonResponse> {
  const { req, sessionName, sessionStore, contextFromFlags, dispatch } = params;
  const predicate = (req.positionals?.[0] ?? '').toLowerCase();
  if (!isSupportedPredicate(predicate)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: 'is requires predicate: visible|hidden|exists|editable|selected|text',
      },
    };
  }
  const session = sessionStore.get(sessionName);
  if (!session) {
    return {
      ok: false,
      error: { code: 'SESSION_NOT_FOUND', message: 'No active session. Run open first.' },
    };
  }
  if (!isCommandSupportedOnDevice('is', session.device)) {
    return {
      ok: false,
      error: { code: 'UNSUPPORTED_OPERATION', message: 'is is not supported on this device' },
    };
  }
  const { split } = splitIsSelectorArgs(req.positionals);
  if (!split) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: 'is requires a selector expression',
      },
    };
  }
  const expectedText = split.rest.join(' ').trim();
  if (predicate === 'text' && !expectedText) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: 'is text requires expected text value',
      },
    };
  }
  if (predicate !== 'text' && split.rest.length > 0) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: `is ${predicate} does not accept trailing values`,
      },
    };
  }
  const chain = parseSelectorChain(split.selectorExpression);
  const snapshot = await captureSnapshotForSession(
    session,
    req.flags,
    sessionStore,
    contextFromFlags,
    { interactiveOnly: false },
    dispatch,
  );
  if (predicate === 'exists') {
    const matched = findSelectorChainMatch(snapshot.nodes, chain, {
      platform: session.device.platform,
    });
    if (!matched) {
      return {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: formatSelectorFailure(chain, [], { unique: false }),
        },
      };
    }
    sessionStore.recordAction(session, {
      command: req.command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: {
        predicate,
        selector: matched.selector.raw,
        selectorChain: chain.selectors.map((entry) => entry.raw),
        pass: true,
        matches: matched.matches,
      },
    });
    return {
      ok: true,
      data: { predicate, pass: true, selector: matched.selector.raw, matches: matched.matches },
    };
  }

  const resolvedSelectorTarget = await resolveSelectorTarget({
    command: 'is',
    selectorExpression: split.selectorExpression,
    session,
    flags: req.flags,
    sessionStore,
    contextFromFlags,
    interactiveOnly: false,
    requireRect: false,
    requireUnique: true,
    disambiguateAmbiguous: false,
    dispatch,
  });
  if (!resolvedSelectorTarget.ok) return resolvedSelectorTarget.response;
  const { resolved } = resolvedSelectorTarget;
  const result = evaluateIsPredicate({
    predicate,
    node: resolved.node,
    expectedText,
    platform: session.device.platform,
  });
  if (!result.pass) {
    return {
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: `is ${predicate} failed for selector ${resolved.selector.raw}: ${result.details}`,
      },
    };
  }
  sessionStore.recordAction(session, {
    command: req.command,
    positionals: req.positionals ?? [],
    flags: req.flags ?? {},
    result: {
      predicate,
      selector: resolved.selector.raw,
      selectorChain: chain.selectors.map((entry) => entry.raw),
      pass: true,
      text: predicate === 'text' ? result.actualText : undefined,
    },
  });
  return { ok: true, data: { predicate, pass: true, selector: resolved.selector.raw } };
}
