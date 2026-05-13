import type {
  FillCommandResult,
  InteractionTarget,
  PressCommandResult,
} from '../../commands/index.ts';
import { fillCommandCodec, interactionTargetCodec } from '../../command-codecs.ts';
import type { DaemonResponse } from '../types.ts';
import { parseCoordinateTarget } from './interaction-targeting.ts';
import { errorResponse } from './response.ts';

export type ParsedPressTarget =
  | { ok: true; target: InteractionTarget }
  | { ok: false; response: DaemonResponse };

export function parsePressTarget(positionals: string[], commandLabel: string): ParsedPressTarget {
  const coordinates = parseCoordinateTarget(positionals);
  if (coordinates) {
    return { ok: true, target: { kind: 'point', x: coordinates.x, y: coordinates.y } };
  }
  const first = positionals[0] ?? '';
  if (first.startsWith('@')) {
    const parsed = interactionTargetCodec.decode(positionals);
    return {
      ok: true,
      target: {
        kind: 'ref',
        ref: first,
        fallbackLabel: parsed.label ?? '',
      },
    };
  }
  const selector = positionals.join(' ').trim();
  if (!selector) {
    return {
      ok: false,
      response: errorResponse(
        'INVALID_ARGS',
        `${commandLabel} requires @ref, selector expression, or x y coordinates`,
      ),
    };
  }
  return { ok: true, target: { kind: 'selector', selector } };
}

export type ParsedFillTarget =
  | { ok: true; target: InteractionTarget; text: string }
  | { ok: false; response: DaemonResponse };

export function parseFillTarget(positionals: string[]): ParsedFillTarget {
  const first = positionals[0] ?? '';
  if (first.startsWith('@')) {
    const parsed = fillCommandCodec.decode(positionals);
    const text = parsed.text;
    if (!text)
      return { ok: false, response: errorResponse('INVALID_ARGS', 'fill requires text after ref') };
    return {
      ok: true,
      target: {
        kind: 'ref',
        ref: first,
        fallbackLabel: readRefFallbackLabel(positionals),
      },
      text,
    };
  }

  const coordinates = parseCoordinateTarget(positionals);
  if (coordinates) {
    const text = positionals.slice(2).join(' ');
    if (!text)
      return {
        ok: false,
        response: errorResponse('INVALID_ARGS', 'fill requires text after coordinates'),
      };
    return { ok: true, target: { kind: 'point', x: coordinates.x, y: coordinates.y }, text };
  }

  const parsed = fillCommandCodec.decode(positionals);
  if (parsed.kind !== 'selector') {
    return {
      ok: false,
      response: errorResponse(
        'INVALID_ARGS',
        'fill requires x y text, @ref text, or selector text',
      ),
    };
  }
  const text = parsed.text.trim();
  if (!text) {
    return {
      ok: false,
      response: errorResponse('INVALID_ARGS', 'fill requires text after selector'),
    };
  }
  return {
    ok: true,
    target: { kind: 'selector', selector: parsed.target.selector },
    text,
  };
}

export function interactionResultExtra(
  result: PressCommandResult | FillCommandResult,
): Record<string, unknown> {
  if (result.kind === 'ref') {
    return {
      ref: stripAtPrefix(result.target?.kind === 'ref' ? result.target.ref : undefined),
      refLabel: result.refLabel,
      selectorChain: result.selectorChain,
    };
  }
  if (result.kind === 'selector') {
    return {
      selector: result.target?.kind === 'selector' ? result.target.selector : undefined,
      selectorChain: result.selectorChain,
      refLabel: result.refLabel,
    };
  }
  return {};
}

export function formatPressTargetLabel(
  target: InteractionTarget,
  result: PressCommandResult,
): string {
  if (target.kind === 'point') return 'coordinate tap';
  if (result.kind === 'ref' && result.target?.kind === 'ref') return result.target.ref;
  if (result.kind === 'selector' && result.target?.kind === 'selector')
    return result.target.selector;
  return 'target';
}

export function stripAtPrefix(ref: string | undefined): string | undefined {
  return ref?.startsWith('@') ? ref.slice(1) : ref;
}

function readRefFallbackLabel(positionals: string[]): string {
  return positionals.length >= 3 ? positionals[1]?.trim() || '' : '';
}
