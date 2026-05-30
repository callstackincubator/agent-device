import type {
  ClickOptions,
  FindOptions,
  FillOptions,
  FlingOptions,
  FocusOptions,
  GetOptions,
  PanOptions,
  PinchOptions,
  PressOptions,
  IsOptions,
  LongPressOptions,
  RotateGestureOptions,
  ScrollOptions,
  SwipeGestureOptions,
  SwipeOptions,
  TransformGestureOptions,
  TypeTextOptions,
} from '../client-types.ts';
import { defineExecutableCommand } from './command-contract.ts';
import {
  commonToClientOptions,
  toClientElementTarget,
  toClientInteractionTarget,
  toRepeatedOptions,
  toSelectorSnapshotOptions,
} from './command-input.ts';
import {
  interactionCommandMetadata,
  type ClickInput,
  type FillInput,
  type FlingInput,
  type GetInput,
  type LongPressInput,
  type PanInput,
  type PinchInput,
  type PressInput,
  type RotateInput,
  type SwipeGestureInput,
  type TransformInput,
} from './interaction-command-metadata.ts';

type InteractionCommandMetadata = (typeof interactionCommandMetadata)[number];
type InteractionCommandName = InteractionCommandMetadata['name'];

export const interactionCommandDefinitions = [
  defineExecutableCommand(metadata('click'), (client, input) =>
    client.interactions.click(toClickOptions(input)),
  ),
  defineExecutableCommand(metadata('press'), (client, input) =>
    client.interactions.press(toPressOptions(input)),
  ),
  defineExecutableCommand(metadata('fill'), (client, input) =>
    client.interactions.fill(toFillOptions(input)),
  ),
  defineExecutableCommand(metadata('longpress'), (client, input) =>
    client.interactions.longPress(toLongPressOptions(input)),
  ),
  defineExecutableCommand(metadata('swipe'), (client, input) =>
    client.interactions.swipe(input as SwipeOptions),
  ),
  defineExecutableCommand(metadata('focus'), (client, input) =>
    client.interactions.focus(input as FocusOptions),
  ),
  defineExecutableCommand(metadata('type'), (client, input) =>
    client.interactions.type(input as TypeTextOptions),
  ),
  defineExecutableCommand(metadata('scroll'), (client, input) =>
    client.interactions.scroll(input as ScrollOptions),
  ),
  defineExecutableCommand(metadata('get'), (client, input) =>
    client.interactions.get(toGetOptions(input)),
  ),
  defineExecutableCommand(metadata('is'), (client, input) =>
    client.interactions.is(input as IsOptions),
  ),
  defineExecutableCommand(metadata('find'), (client, input) =>
    client.interactions.find(input as FindOptions),
  ),
  defineExecutableCommand(metadata('gesture'), async (client, input) => {
    switch (input.kind) {
      case 'pan':
        return await client.interactions.pan(toPanOptions(input));
      case 'fling':
        return await client.interactions.fling(toFlingOptions(input));
      case 'swipe':
        return await client.interactions.swipeGesture(toSwipeGestureOptions(input));
      case 'pinch':
        return await client.interactions.pinch(toPinchOptions(input));
      case 'rotate':
        return await client.interactions.rotateGesture(toRotateOptions(input));
      case 'transform':
        return await client.interactions.transformGesture(toTransformOptions(input));
    }
  }),
] as const;

function metadata<TName extends InteractionCommandName>(
  name: TName,
): Extract<InteractionCommandMetadata, { name: TName }> {
  const definition = interactionCommandMetadata.find((item) => item.name === name);
  if (!definition) throw new Error(`Missing interaction command metadata for ${name}`);
  return definition as Extract<InteractionCommandMetadata, { name: TName }>;
}

function toClickOptions(input: ClickInput): ClickOptions {
  return {
    ...commonToClientOptions(input),
    ...toClientInteractionTarget(input.target),
    ...toSelectorSnapshotOptions(input),
    ...toRepeatedOptions(input),
    button: input.button,
  };
}

function toPressOptions(input: PressInput): PressOptions {
  return {
    ...commonToClientOptions(input),
    ...toClientInteractionTarget(input.target),
    ...toSelectorSnapshotOptions(input),
    ...toRepeatedOptions(input),
  };
}

function toFillOptions(input: FillInput): FillOptions {
  return {
    ...commonToClientOptions(input),
    ...toClientInteractionTarget(input.target),
    ...toSelectorSnapshotOptions(input),
    text: input.text,
    delayMs: input.delayMs,
  };
}

function toLongPressOptions(input: LongPressInput): LongPressOptions {
  return {
    ...commonToClientOptions(input),
    ...toClientInteractionTarget(input.target),
    ...toSelectorSnapshotOptions(input),
    durationMs: input.durationMs,
  };
}

function toGetOptions(input: GetInput): GetOptions {
  return {
    ...commonToClientOptions(input),
    ...toClientElementTarget(input.target),
    ...toSelectorSnapshotOptions(input),
    format: input.format,
  };
}

function toPanOptions(input: PanInput): PanOptions {
  return {
    ...commonToClientOptions(input),
    x: input.origin.x,
    y: input.origin.y,
    dx: input.delta.x,
    dy: input.delta.y,
    durationMs: input.durationMs,
  };
}

function toFlingOptions(input: FlingInput): FlingOptions {
  return {
    ...commonToClientOptions(input),
    direction: input.direction,
    x: input.origin.x,
    y: input.origin.y,
    distance: input.distance,
    durationMs: input.durationMs,
  };
}

function toSwipeGestureOptions(input: SwipeGestureInput): SwipeGestureOptions {
  return {
    ...commonToClientOptions(input),
    preset: input.preset,
    durationMs: input.durationMs,
  };
}

function toPinchOptions(input: PinchInput): PinchOptions {
  return {
    ...commonToClientOptions(input),
    scale: input.scale,
    x: input.origin?.x,
    y: input.origin?.y,
  };
}

function toRotateOptions(input: RotateInput): RotateGestureOptions {
  return {
    ...commonToClientOptions(input),
    degrees: input.degrees,
    x: input.origin?.x,
    y: input.origin?.y,
    velocity: input.velocity,
  };
}

function toTransformOptions(input: TransformInput): TransformGestureOptions {
  return {
    ...commonToClientOptions(input),
    x: input.origin.x,
    y: input.origin.y,
    dx: input.delta.x,
    dy: input.delta.y,
    scale: input.scale,
    degrees: input.degrees,
    durationMs: input.durationMs,
  };
}
