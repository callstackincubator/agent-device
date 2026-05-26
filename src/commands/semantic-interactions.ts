import type {
  ClickOptions,
  FlingOptions,
  FillOptions,
  PanOptions,
  PinchOptions,
  PressOptions,
  RotateGestureOptions,
  TransformGestureOptions,
} from '../client-types.ts';
import { defineSemanticCommand } from './semantic-contract.ts';
import {
  commandInputSchema,
  commandResultSchema,
  commonToClientOptions,
  interactionInputSchema,
  optionalEnum,
  optionalInteger,
  pointSchema,
  readCommonInput,
  readInputRecord,
  readInteractionTarget,
  readPoint,
  readRepeatedInput,
  readSelectorSnapshotInput,
  repeatedProperties,
  requiredEnum,
  requiredNumber,
  requiredString,
  toClientInteractionTarget,
  toRepeatedOptions,
  toSelectorSnapshotOptions,
  type CommonCommandInput,
  type PointInput,
  type RepeatedInput,
  type SelectorSnapshotInput,
  type SemanticInteractionTarget,
} from './semantic-common.ts';

const CLICK_BUTTON_VALUES = ['primary', 'secondary', 'middle'] as const;
const GESTURE_KIND_VALUES = ['pan', 'fling', 'pinch', 'rotate', 'transform'] as const;
const GESTURE_DIRECTION_VALUES = ['up', 'down', 'left', 'right'] as const;

type ClickInput = CommonCommandInput &
  RepeatedInput &
  SelectorSnapshotInput & {
    target: SemanticInteractionTarget;
    button?: 'primary' | 'secondary' | 'middle';
  };

type PressInput = CommonCommandInput &
  RepeatedInput &
  SelectorSnapshotInput & {
    target: SemanticInteractionTarget;
  };

type FillInput = CommonCommandInput &
  SelectorSnapshotInput & {
    target: SemanticInteractionTarget;
    text: string;
    delayMs?: number;
  };

type PanInput = CommonCommandInput & {
  kind: 'pan';
  origin: PointInput;
  delta: PointInput;
  durationMs?: number;
};

type FlingInput = CommonCommandInput & {
  kind: 'fling';
  direction: 'up' | 'down' | 'left' | 'right';
  origin: PointInput;
  distance?: number;
  durationMs?: number;
};

type PinchInput = CommonCommandInput & {
  kind: 'pinch';
  scale: number;
  origin?: PointInput;
};

type RotateInput = CommonCommandInput & {
  kind: 'rotate';
  degrees: number;
  origin?: PointInput;
  velocity?: number;
};

type TransformInput = CommonCommandInput & {
  kind: 'transform';
  origin: PointInput;
  delta: PointInput;
  scale: number;
  degrees: number;
  durationMs?: number;
};

type GestureInput = PanInput | FlingInput | PinchInput | RotateInput | TransformInput;

export const interactionSemanticCommands = [
  defineSemanticCommand({
    name: 'click',
    description: 'Click or tap a semantic UI target by ref, selector, or point.',
    inputSchema: interactionInputSchema({
      button: {
        type: 'string',
        enum: CLICK_BUTTON_VALUES,
        description: 'Pointer button for platforms that support mouse buttons.',
      },
      ...repeatedProperties(),
    }),
    outputSchema: commandResultSchema(),
    readInput: readClickInput,
    run: (client, input) => client.interactions.click(toClickOptions(input)),
  }),
  defineSemanticCommand({
    name: 'press',
    description: 'Press a semantic UI target by ref, selector, or point.',
    inputSchema: interactionInputSchema(repeatedProperties()),
    outputSchema: commandResultSchema(),
    readInput: readPressInput,
    run: (client, input) => client.interactions.press(toPressOptions(input)),
  }),
  defineSemanticCommand({
    name: 'fill',
    description: 'Fill text into a semantic UI target by ref, selector, or point.',
    inputSchema: interactionInputSchema(
      {
        text: { type: 'string', description: 'Text to enter into the target.' },
        delayMs: { type: 'integer', minimum: 0, description: 'Delay between typed characters.' },
      },
      ['target', 'text'],
    ),
    outputSchema: commandResultSchema(),
    readInput: readFillInput,
    run: (client, input) => client.interactions.fill(toFillOptions(input)),
  }),
  defineSemanticCommand({
    name: 'gesture',
    description: 'Run a structured gesture.',
    inputSchema: commandInputSchema(
      {
        kind: {
          type: 'string',
          enum: GESTURE_KIND_VALUES,
          description: 'Gesture variant.',
        },
        direction: {
          type: 'string',
          enum: GESTURE_DIRECTION_VALUES,
          description: 'Fling direction.',
        },
        origin: pointSchema('Gesture origin point.'),
        delta: pointSchema('Movement delta for pan or transform gestures.'),
        distance: { type: 'number', description: 'Fling distance.' },
        scale: { type: 'number', description: 'Pinch or transform scale.' },
        degrees: {
          type: 'number',
          description: 'Rotation in degrees.',
        },
        velocity: {
          type: 'number',
          description: 'Rotate gesture velocity.',
        },
        durationMs: {
          type: 'integer',
          minimum: 0,
          description: 'Gesture duration in milliseconds.',
        },
      },
      ['kind'],
    ),
    outputSchema: commandResultSchema(),
    readInput: readGestureInput,
    run: async (client, input) => {
      switch (input.kind) {
        case 'pan':
          return await client.interactions.pan(toPanOptions(input));
        case 'fling':
          return await client.interactions.fling(toFlingOptions(input));
        case 'pinch':
          return await client.interactions.pinch(toPinchOptions(input));
        case 'rotate':
          return await client.interactions.rotateGesture(toRotateOptions(input));
        case 'transform':
          return await client.interactions.transformGesture(toTransformOptions(input));
      }
    },
  }),
] as const;

function readClickInput(input: unknown): ClickInput {
  const record = readInputRecord(input);
  return {
    ...readCommonInput(record),
    target: readInteractionTarget(record, 'target'),
    button: optionalEnum(record, 'button', CLICK_BUTTON_VALUES),
    ...readSelectorSnapshotInput(record),
    ...readRepeatedInput(record),
  };
}

function readPressInput(input: unknown): PressInput {
  const record = readInputRecord(input);
  return {
    ...readCommonInput(record),
    target: readInteractionTarget(record, 'target'),
    ...readSelectorSnapshotInput(record),
    ...readRepeatedInput(record),
  };
}

function readFillInput(input: unknown): FillInput {
  const record = readInputRecord(input);
  return {
    ...readCommonInput(record),
    target: readInteractionTarget(record, 'target'),
    text: requiredString(record, 'text'),
    delayMs: optionalInteger(record, 'delayMs', { min: 0 }),
    ...readSelectorSnapshotInput(record),
  };
}

function readGestureInput(input: unknown): GestureInput {
  const record = readInputRecord(input);
  const common = readCommonInput(record);
  const kind = requiredEnum(record, 'kind', GESTURE_KIND_VALUES);
  if (kind === 'pan') {
    return {
      ...common,
      kind,
      origin: readPoint(record, 'origin'),
      delta: readPoint(record, 'delta'),
      durationMs: optionalInteger(record, 'durationMs', { min: 0 }),
    };
  }
  if (kind === 'fling') {
    return {
      ...common,
      kind,
      direction: requiredEnum(record, 'direction', GESTURE_DIRECTION_VALUES),
      origin: readPoint(record, 'origin'),
      distance: optionalInteger(record, 'distance', { min: 0 }),
      durationMs: optionalInteger(record, 'durationMs', { min: 0 }),
    };
  }
  if (kind === 'pinch') {
    return {
      ...common,
      kind,
      scale: requiredNumber(record, 'scale'),
      origin: optionalPoint(record, 'origin'),
    };
  }
  if (kind === 'rotate') {
    return {
      ...common,
      kind,
      degrees: requiredNumber(record, 'degrees'),
      origin: optionalPoint(record, 'origin'),
      velocity: optionalInteger(record, 'velocity', { min: 0 }),
    };
  }
  return {
    ...common,
    kind,
    origin: readPoint(record, 'origin'),
    delta: readPoint(record, 'delta'),
    scale: requiredNumber(record, 'scale'),
    degrees: requiredNumber(record, 'degrees'),
    durationMs: optionalInteger(record, 'durationMs', { min: 0 }),
  };
}

function optionalPoint(record: Record<string, unknown>, key: string): PointInput | undefined {
  return record[key] === undefined ? undefined : readPoint(record, key);
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
