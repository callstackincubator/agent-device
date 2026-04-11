import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { buildSelectorChainForNode } from '../selectors.ts';
import type { DaemonResponse } from '../types.ts';
import type { InteractionHandlerParams } from './interaction-common.ts';
import { refSnapshotFlagGuardResponse } from './interaction-flags.ts';
import { readTextForNode } from './interaction-read.ts';
import { resolveRefTarget } from './interaction-targeting.ts';
import { resolveSelectorTarget } from './interaction-selector.ts';
import { errorResponse } from './response.ts';

export async function handleGetCommand(params: InteractionHandlerParams): Promise<DaemonResponse> {
  const { req, sessionName, sessionStore, contextFromFlags } = params;
  const sub = req.positionals?.[0];
  if (sub !== 'text' && sub !== 'attrs') {
    return errorResponse('INVALID_ARGS', 'get only supports text or attrs');
  }
  const session = sessionStore.get(sessionName);
  if (!session) return errorResponse('SESSION_NOT_FOUND', 'No active session. Run open first.');
  if (!isCommandSupportedOnDevice('get', session.device)) {
    return errorResponse('UNSUPPORTED_OPERATION', 'get is not supported on this device');
  }
  const refInput = req.positionals?.[1] ?? '';
  if (refInput.startsWith('@')) {
    const invalidRefFlagsResponse = refSnapshotFlagGuardResponse('get', req.flags);
    if (invalidRefFlagsResponse) return invalidRefFlagsResponse;
    const labelCandidate =
      req.positionals.length > 2 ? req.positionals.slice(2).join(' ').trim() : '';
    const resolvedRefTarget = resolveRefTarget({
      session,
      refInput,
      fallbackLabel: labelCandidate,
      requireRect: false,
      invalidRefMessage: 'get text requires a ref like @e2',
      notFoundMessage: `Ref ${refInput} not found`,
    });
    if (!resolvedRefTarget.ok) return resolvedRefTarget;
    const { ref, node } = resolvedRefTarget.target;
    const selectorChain = buildSelectorChainForNode(node, session.device.platform, {
      action: 'get',
    });
    if (sub === 'attrs') {
      sessionStore.recordAction(session, {
        command: req.command,
        positionals: req.positionals ?? [],
        flags: req.flags ?? {},
        result: { ref, selectorChain },
      });
      return { ok: true, data: { ref, node } };
    }
    const text = await readTextForNode({
      device: session.device,
      node,
      flags: req.flags,
      appBundleId: session.appBundleId,
      traceOutPath: session.trace?.outPath,
      surface: session.surface,
      contextFromFlags,
    });
    sessionStore.recordAction(session, {
      command: req.command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { ref, text, refLabel: compactRecordedGetRefLabel(text), selectorChain },
    });
    return { ok: true, data: { ref, text, node } };
  }

  const selectorExpression = req.positionals.slice(1).join(' ').trim();
  if (!selectorExpression) {
    return errorResponse('INVALID_ARGS', 'get requires @ref or selector expression');
  }
  const resolvedSelectorTarget = await resolveSelectorTarget({
    command: req.command,
    selectorExpression,
    session,
    flags: req.flags,
    sessionStore,
    contextFromFlags,
    interactiveOnly: false,
    requireRect: false,
    requireUnique: true,
    disambiguateAmbiguous: sub === 'text',
  });
  if (!resolvedSelectorTarget.ok) return resolvedSelectorTarget;
  const { resolved } = resolvedSelectorTarget;
  const node = resolved.node;
  const selectorChain = buildSelectorChainForNode(node, session.device.platform, {
    action: 'get',
  });
  if (sub === 'attrs') {
    sessionStore.recordAction(session, {
      command: req.command,
      positionals: req.positionals ?? [],
      flags: req.flags ?? {},
      result: { selector: resolved.selector.raw, selectorChain },
    });
    return { ok: true, data: { selector: resolved.selector.raw, node } };
  }
  const text = await readTextForNode({
    device: session.device,
    node,
    flags: req.flags,
    appBundleId: session.appBundleId,
    traceOutPath: session.trace?.outPath,
    surface: session.surface,
    contextFromFlags,
  });
  sessionStore.recordAction(session, {
    command: req.command,
    positionals: req.positionals ?? [],
    flags: req.flags ?? {},
    result: {
      text,
      refLabel: compactRecordedGetRefLabel(text),
      selector: resolved.selector.raw,
      selectorChain,
    },
  });
  return { ok: true, data: { selector: resolved.selector.raw, text, node } };
}

function compactRecordedGetRefLabel(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 80 || /[\r\n]/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}
