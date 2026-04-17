import { AppError } from '../utils/errors.ts';
import type { ClickButton } from '../core/click-button.ts';
import type { AgentDeviceRuntime, CommandContext } from '../runtime.ts';
import { isFillableType } from '../utils/snapshot-processing.ts';
import { requireIntInRange } from '../utils/validation.ts';
import { successText } from '../utils/success-text.ts';
import type { ResolvedTarget } from './selector-read.ts';
import { toBackendContext } from './selector-read-utils.ts';
import type { RuntimeCommand } from './index.ts';
import {
  type InteractionTarget,
  type ResolvedInteractionTarget,
  resolveInteractionTarget,
} from './interaction-resolution.ts';

export {
  focusCommand,
  longPressCommand,
  pinchCommand,
  scrollCommand,
  swipeCommand,
} from './interaction-gestures.ts';
export type {
  FocusCommandOptions,
  FocusCommandResult,
  GestureDirection,
  LongPressCommandOptions,
  LongPressCommandResult,
  PinchCommandOptions,
  PinchCommandResult,
  ScrollCommandOptions,
  ScrollCommandResult,
  ScrollTarget,
  SwipeCommandOptions,
  SwipeCommandResult,
  SwipeOptions,
} from './interaction-gestures.ts';
export type {
  InteractionTarget,
  PointTarget,
  ResolvedInteractionTarget,
} from './interaction-resolution.ts';

export type PressCommandOptions = CommandContext & {
  target: InteractionTarget;
  button?: ClickButton;
  count?: number;
  intervalMs?: number;
  holdMs?: number;
  jitterPx?: number;
  doubleTap?: boolean;
};

export type ClickCommandOptions = PressCommandOptions;

export type PressCommandResult = ResolvedInteractionTarget & {
  backendResult?: Record<string, unknown>;
};

export type FillCommandOptions = CommandContext & {
  target: InteractionTarget;
  text: string;
  delayMs?: number;
};

export type FillCommandResult = ResolvedInteractionTarget & {
  text: string;
  warning?: string;
  backendResult?: Record<string, unknown>;
};

export type TypeTextCommandOptions = CommandContext & {
  text: string;
  delayMs?: number;
};

export type TypeTextCommandResult = {
  kind: 'text';
  text: string;
  delayMs: number;
  backendResult?: Record<string, unknown>;
  message?: string;
};

export const pressCommand: RuntimeCommand<PressCommandOptions, PressCommandResult> = async (
  runtime,
  options,
): Promise<PressCommandResult> => await tapCommand(runtime, options, 'press');

export const clickCommand: RuntimeCommand<ClickCommandOptions, PressCommandResult> = async (
  runtime,
  options,
): Promise<PressCommandResult> => await tapCommand(runtime, options, 'click');

export const fillCommand: RuntimeCommand<FillCommandOptions, FillCommandResult> = async (
  runtime,
  options,
): Promise<FillCommandResult> => {
  if (!options.text) throw new AppError('INVALID_ARGS', 'fill requires text');
  const resolved = await resolveInteractionTarget(runtime, options, {
    action: 'fill',
    requireInteractive: true,
    promoteToHittableAncestor: false,
  });
  if (!runtime.backend.fill) {
    throw new AppError('UNSUPPORTED_OPERATION', 'fill is not supported by this backend');
  }
  const backendResult = await runtime.backend.fill(
    toBackendContext(runtime, options),
    resolved.point,
    options.text,
    { delayMs: options.delayMs },
  );
  const formattedBackendResult = toBackendResult(backendResult);
  const nodeType = 'node' in resolved ? (resolved.node.type ?? '') : '';
  const warning =
    nodeType && !isFillableType(nodeType, runtime.backend.platform)
      ? `fill target ${formatTargetForWarning(resolved)} resolved to "${nodeType}", attempting fill anyway.`
      : undefined;
  return {
    ...resolved,
    text: options.text,
    ...(warning ? { warning } : {}),
    ...(formattedBackendResult ? { backendResult: formattedBackendResult } : {}),
  };
};

export const typeTextCommand: RuntimeCommand<
  TypeTextCommandOptions,
  TypeTextCommandResult
> = async (runtime, options): Promise<TypeTextCommandResult> => {
  const text = options.text;
  if (!text) throw new AppError('INVALID_ARGS', 'type requires text');
  const mistargetedRef = findMistargetedTypeRef(text);
  if (mistargetedRef) {
    throw new AppError(
      'INVALID_ARGS',
      `type does not accept a target ref like "${mistargetedRef}"`,
      {
        hint: `Use fill ${mistargetedRef} "text" to target that field, or press ${mistargetedRef} then type "text" to append.`,
      },
    );
  }
  if (!runtime.backend.typeText) {
    throw new AppError('UNSUPPORTED_OPERATION', 'type is not supported by this backend');
  }
  const delayMs = requireIntInRange(options.delayMs ?? 0, 'delay-ms', 0, 10_000);
  const backendResult = await runtime.backend.typeText(toBackendContext(runtime, options), text, {
    delayMs,
  });
  const formattedBackendResult = toBackendResult(backendResult);
  return {
    kind: 'text',
    text,
    delayMs,
    ...(formattedBackendResult ? { backendResult: formattedBackendResult } : {}),
    ...successText(`Typed ${Array.from(text).length} chars`),
  };
};

async function tapCommand(
  runtime: AgentDeviceRuntime,
  options: PressCommandOptions,
  action: 'click' | 'press',
): Promise<PressCommandResult> {
  const resolved = await resolveInteractionTarget(runtime, options, {
    action,
    requireInteractive: true,
    promoteToHittableAncestor: true,
  });
  if (!runtime.backend.tap) {
    throw new AppError('UNSUPPORTED_OPERATION', 'tap is not supported by this backend');
  }
  const backendResult = await runtime.backend.tap(
    toBackendContext(runtime, options),
    resolved.point,
    {
      button: options.button,
      count: options.count,
      intervalMs: options.intervalMs,
      holdMs: options.holdMs,
      jitterPx: options.jitterPx,
      doubleTap: options.doubleTap,
    },
  );
  const formattedBackendResult = toBackendResult(backendResult);
  return {
    ...resolved,
    ...(formattedBackendResult ? { backendResult: formattedBackendResult } : {}),
  };
}

function toBackendResult(result: unknown): Record<string, unknown> | undefined {
  return result && typeof result === 'object' ? (result as Record<string, unknown>) : undefined;
}

function formatTargetForWarning(result: {
  kind: FillCommandResult['kind'];
  target?: ResolvedTarget;
}): string {
  if (result.target?.kind === 'ref') return result.target.ref;
  if (result.target?.kind === 'selector') return result.target.selector;
  return 'point';
}

function findMistargetedTypeRef(text: string): string | null {
  const first = text.trim().split(/\s+/, 1)[0];
  if (!first || !first.startsWith('@') || first.length < 3) {
    return null;
  }
  const body = first.slice(1);
  if (/^[A-Za-z_-]*\d[\w-]*$/i.test(body) || /^(?:ref|node|element|el)[\w-]*$/i.test(body)) {
    return first;
  }
  return null;
}
