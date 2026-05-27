import type {
  AgentDeviceClient,
  ClickOptions,
  FindOptions,
  FlingOptions,
  FillOptions,
  FocusOptions,
  GetOptions,
  PanOptions,
  PinchOptions,
  PressOptions,
  IsOptions,
  LongPressOptions,
  RotateGestureOptions,
  ScrollOptions,
  SwipeOptions,
  TransformGestureOptions,
  TypeTextOptions,
} from '../client-types.ts';
import { defineCommand } from './command-contract.ts';
import {
  booleanField,
  commonToClientOptions,
  elementTargetField,
  enumField,
  fieldsInputSchema,
  integerField,
  interactionTargetField,
  numberField,
  optionalInteger,
  pointField,
  readCommonInput,
  readFieldInput,
  readInputRecord,
  readPoint,
  repeatedFields,
  requiredEnum,
  requiredField,
  requiredNumber,
  selectorSnapshotFields,
  stringField,
  toClientElementTarget,
  toClientInteractionTarget,
  toRepeatedOptions,
  toSelectorSnapshotOptions,
  type CommonCommandInput,
  type CommandFieldMap,
  type InferCommandInput,
  type PointInput,
} from './command-input.ts';

const CLICK_BUTTON_VALUES = ['primary', 'secondary', 'middle'] as const;
const GESTURE_KIND_VALUES = ['pan', 'fling', 'pinch', 'rotate', 'transform'] as const;
const GESTURE_DIRECTION_VALUES = ['up', 'down', 'left', 'right'] as const;
const FIND_ACTION_VALUES = [
  'click',
  'focus',
  'exists',
  'getText',
  'getAttrs',
  'wait',
  'fill',
  'type',
] as const;
const FIND_LOCATOR_VALUES = ['any', 'text', 'label', 'value', 'role', 'id'] as const;
const SCROLL_DIRECTION_VALUES = ['up', 'down', 'left', 'right', 'top', 'bottom'] as const;
const SWIPE_PATTERN_VALUES = ['one-way', 'ping-pong'] as const;

const clickFields = {
  target: requiredField(interactionTargetField()),
  button: enumField(
    CLICK_BUTTON_VALUES,
    'Pointer button for platforms that support mouse buttons.',
  ),
  ...selectorSnapshotFields(),
  ...repeatedFields(),
};

const pressFields = {
  target: requiredField(interactionTargetField()),
  ...selectorSnapshotFields(),
  ...repeatedFields(),
};

const fillFields = {
  target: requiredField(interactionTargetField()),
  text: requiredField(stringField('Text to enter into the target.')),
  delayMs: integerField('Delay between typed characters.', { min: 0 }),
  ...selectorSnapshotFields(),
};

const longPressFields = {
  target: requiredField(interactionTargetField()),
  durationMs: integerField('Long press duration in milliseconds.', { min: 0 }),
  ...selectorSnapshotFields(),
};

const swipeFields = {
  from: requiredField(pointField('Swipe start point.')),
  to: requiredField(pointField('Swipe end point.')),
  durationMs: integerField('Swipe duration in milliseconds.', { min: 0 }),
  count: integerField('Number of swipe repetitions.', { min: 1 }),
  pauseMs: integerField('Pause between repeated swipes.', { min: 0 }),
  pattern: enumField(SWIPE_PATTERN_VALUES),
};

const focusFields = {
  x: requiredField(numberField('X coordinate.')),
  y: requiredField(numberField('Y coordinate.')),
};

const typeFields = {
  text: requiredField(stringField('Text to type.')),
  delayMs: integerField('Delay between typed characters.', { min: 0 }),
};

const scrollFields = {
  direction: requiredField(enumField(SCROLL_DIRECTION_VALUES)),
  amount: numberField('Platform scroll amount.'),
  pixels: integerField('Pixel scroll amount.', { min: 0 }),
};

const getFields = {
  format: requiredField(enumField(['text', 'attrs'] as const)),
  target: requiredField(elementTargetField()),
  ...selectorSnapshotFields(),
};

const isFields = {
  predicate: requiredField(
    enumField(['visible', 'hidden', 'exists', 'editable', 'selected', 'text'] as const),
  ),
  selector: requiredField(stringField()),
  value: stringField(),
  ...selectorSnapshotFields(),
};

const findFields = {
  locator: enumField(FIND_LOCATOR_VALUES),
  query: requiredField(stringField()),
  action: enumField(FIND_ACTION_VALUES),
  value: stringField(),
  timeoutMs: integerField(),
  first: booleanField(),
  last: booleanField(),
  depth: integerField(),
  raw: booleanField(),
};

const gestureFields = {
  kind: requiredField(enumField(GESTURE_KIND_VALUES, 'Gesture variant.')),
  direction: enumField(GESTURE_DIRECTION_VALUES, 'Fling direction.'),
  origin: pointField('Gesture origin point.'),
  delta: pointField('Movement delta for pan or transform gestures.'),
  distance: integerField('Fling distance.', { min: 0 }),
  scale: numberField('Pinch or transform scale.'),
  degrees: numberField('Rotation in degrees.'),
  velocity: integerField('Rotate gesture velocity.', { min: 0 }),
  durationMs: integerField('Gesture duration in milliseconds.', { min: 0 }),
};

type ClickInput = InferCommandInput<typeof clickFields>;
type PressInput = InferCommandInput<typeof pressFields>;
type FillInput = InferCommandInput<typeof fillFields>;
type LongPressInput = InferCommandInput<typeof longPressFields>;
type GetInput = InferCommandInput<typeof getFields>;

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

export const interactionCommandDefinitions = [
  defineCommand({
    name: 'click',
    description: 'Click or tap a semantic UI target by ref, selector, or point.',
    inputSchema: fieldsInputSchema(clickFields),
    readInput: (input) => readFieldInput(input, clickFields),
    run: (client, input) => client.interactions.click(toClickOptions(input)),
  }),
  defineCommand({
    name: 'press',
    description: 'Press a semantic UI target by ref, selector, or point.',
    inputSchema: fieldsInputSchema(pressFields),
    readInput: (input) => readFieldInput(input, pressFields),
    run: (client, input) => client.interactions.press(toPressOptions(input)),
  }),
  defineCommand({
    name: 'fill',
    description: 'Fill text into a semantic UI target by ref, selector, or point.',
    inputSchema: fieldsInputSchema(fillFields),
    readInput: (input) => readFieldInput(input, fillFields),
    run: (client, input) => client.interactions.fill(toFillOptions(input)),
  }),
  defineFieldCommand(
    'longpress',
    'Long press by ref, selector, or point.',
    longPressFields,
    (client, input) => client.interactions.longPress(toLongPressOptions(input)),
  ),
  defineFieldCommand('swipe', 'Swipe between two points.', swipeFields, (client, input) =>
    client.interactions.swipe(input as SwipeOptions),
  ),
  defineFieldCommand('focus', 'Focus input at coordinates.', focusFields, (client, input) =>
    client.interactions.focus(input as FocusOptions),
  ),
  defineFieldCommand('type', 'Type text in the focused field.', typeFields, (client, input) =>
    client.interactions.type(input as TypeTextOptions),
  ),
  defineFieldCommand(
    'scroll',
    'Scroll in a direction or to an edge.',
    scrollFields,
    (client, input) => client.interactions.scroll(input as ScrollOptions),
  ),
  defineFieldCommand('get', 'Get element text or attributes.', getFields, (client, input) =>
    client.interactions.get(toGetOptions(input)),
  ),
  defineFieldCommand('is', 'Assert UI state.', isFields, (client, input) =>
    client.interactions.is(input as IsOptions),
  ),
  defineFieldCommand(
    'find',
    'Find an element and optionally act on it.',
    findFields,
    (client, input) => client.interactions.find(input as FindOptions),
  ),
  defineCommand({
    name: 'gesture',
    description: 'Run a structured gesture.',
    inputSchema: fieldsInputSchema(gestureFields),
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

function defineFieldCommand<
  const TName extends string,
  const TFields extends CommandFieldMap,
  TResult,
>(
  name: TName,
  description: string,
  fields: TFields,
  run: (client: AgentDeviceClient, input: InferCommandInput<TFields>) => Promise<TResult>,
) {
  return defineCommand({
    name,
    description,
    inputSchema: fieldsInputSchema(fields),
    readInput: (input) => readFieldInput(input, fields),
    run,
  });
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
