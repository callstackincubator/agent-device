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
import { errorResponse, sessionNotFoundResponse, unsupportedOperationResponse } from './response.ts';
import { captureSnapshotForSession } from './interaction-snapshot.ts';
import { resolveSelectorTarget } from './interaction-selector.ts';

export async function handleIsCommand(params: InteractionHandlerParams): Promise<DaemonResponse> {
  const { req, sessionName, sessionStore, contextFromFlags } = params;
  const predicate = (req.positionals?.[0] ?? '').toLowerCase();
  if (!isSupportedPredicate(predicate)) {
    return errorResponse('INVALID_ARGS', 'is requires predicate: visible|hidden|exists|editable|selected|text');
  }
  const session = sessionStore.get(sessionName);
  if (!session) {
    return sessionNotFoundResponse();
  }
  if (!isCommandSupportedOnDevice('is', session.device)) {
    return unsupportedOperationResponse('is');
  }
  const { split } = splitIsSelectorArgs(req.positionals);
  if (!split) {
    return errorResponse('INVALID_ARGS', 'is requires a selector expression');
  }
  const expectedText = split.rest.join(' ').trim();
  if (predicate === 'text' && !expectedText) {
    return errorResponse('INVALID_ARGS', 'is text requires expected text value');
  }
  if (predicate !== 'text' && split.rest.length > 0) {
    return errorResponse('INVALID_ARGS', `is ${predicate} does not accept trailing values`);
  }
  const chain = parseSelectorChain(split.selectorExpression);
  if (predicate === 'exists') {
    const snapshot = await captureSnapshotForSession(
      session,
      req.flags,
      sessionStore,
      contextFromFlags,
      { interactiveOnly: false },
    );
    const matched = findSelectorChainMatch(snapshot.nodes, chain, {
      platform: session.device.platform,
    });
    if (!matched) {
      return errorResponse('COMMAND_FAILED', formatSelectorFailure(chain, [], { unique: false }));
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
  });
  if (!resolvedSelectorTarget.ok) return resolvedSelectorTarget.response;
  const { resolved } = resolvedSelectorTarget;
  const result = evaluateIsPredicate({
    predicate,
    node: resolved.node,
    nodes: resolvedSelectorTarget.snapshot.nodes,
    expectedText,
    platform: session.device.platform,
  });
  if (!result.pass) {
    return errorResponse('COMMAND_FAILED', `is ${predicate} failed for selector ${resolved.selector.raw}: ${result.details}`);
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
