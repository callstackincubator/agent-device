import type { ElementTarget, FillOptions, InteractionTarget } from '../client-types.ts';
import { splitSelectorFromArgs } from '../daemon/selectors.ts';
import { AppError } from '../utils/errors.ts';

export type DecodedFillTarget =
  | { kind: 'ref'; target: { ref: string; label?: string }; text: string }
  | { kind: 'selector'; target: { selector: string }; text: string }
  | { kind: 'point'; target: { x: number; y: number }; text: string };

export function readInteractionTargetFromPositionals(positionals: string[]): InteractionTarget {
  if (positionals[0]?.startsWith('@')) {
    return { ref: positionals[0], label: optionalTrimmedText(positionals.slice(1)) };
  }
  const selectorArgs = splitSelectorFromArgs(positionals);
  if (selectorArgs) return { selector: selectorArgs.selectorExpression };
  return { x: Number(positionals[0]), y: Number(positionals[1]) };
}

export function interactionTargetToPositionals(options: InteractionTarget): string[] {
  if (options.ref !== undefined) return [options.ref, ...optionalString(options.label)];
  if (options.selector !== undefined) return [options.selector];
  return [String(options.x), String(options.y)];
}

export function readElementTargetFromPositionals(positionals: string[]): ElementTarget {
  if (positionals[0]?.startsWith('@')) {
    return { ref: positionals[0], label: optionalTrimmedText(positionals.slice(1)) };
  }
  const selector = positionals.join(' ').trim();
  if (!selector) throw new AppError('INVALID_ARGS', 'get requires @ref or selector expression');
  return { selector };
}

export function elementTargetToPositionals(options: ElementTarget): string[] {
  if (options.ref !== undefined) return [options.ref, ...optionalString(options.label)];
  return [options.selector];
}

export function readFillTargetFromPositionals(positionals: string[]): DecodedFillTarget {
  if (positionals[0]?.startsWith('@')) {
    const text =
      positionals.length >= 3 ? positionals.slice(2).join(' ') : positionals.slice(1).join(' ');
    return {
      kind: 'ref',
      target: {
        ref: positionals[0],
        label: positionals.length >= 3 ? optionalTrimmedText([positionals[1]]) : undefined,
      },
      text,
    };
  }
  const selectorArgs = splitSelectorFromArgs(positionals, { preferTrailingValue: true });
  if (selectorArgs) {
    return {
      kind: 'selector',
      target: { selector: selectorArgs.selectorExpression },
      text: selectorArgs.rest.join(' '),
    };
  }
  return {
    kind: 'point',
    target: { x: Number(positionals[0]), y: Number(positionals[1]) },
    text: positionals.slice(2).join(' '),
  };
}

export function fillOptionsToPositionals(options: FillOptions): string[] {
  return [...interactionTargetToPositionals(options), options.text];
}

function optionalString(value: string | undefined): string[] {
  return value === undefined ? [] : [value];
}

function optionalTrimmedText(values: string[]): string | undefined {
  const text = values.join(' ').trim();
  return text || undefined;
}
