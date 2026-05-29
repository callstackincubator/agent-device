import { requireCommandDescription } from './command-descriptions.ts';
import { defineCommandMetadata } from './command-contract.ts';
import {
  booleanField,
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
  type CommandFieldMap,
  type CommonCommandInput,
  type InferCommandInput,
  type PointInput,
} from './command-input.ts';
import { defineFieldCommandMetadata } from './field-command-contract.ts';

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

export type ClickInput = InferCommandInput<typeof clickFields>;
export type PressInput = InferCommandInput<typeof pressFields>;
export type FillInput = InferCommandInput<typeof fillFields>;
export type LongPressInput = InferCommandInput<typeof longPressFields>;
export type GetInput = InferCommandInput<typeof getFields>;

export type PanInput = CommonCommandInput & {
  kind: 'pan';
  origin: PointInput;
  delta: PointInput;
  durationMs?: number;
};

export type FlingInput = CommonCommandInput & {
  kind: 'fling';
  direction: 'up' | 'down' | 'left' | 'right';
  origin: PointInput;
  distance?: number;
  durationMs?: number;
};

export type PinchInput = CommonCommandInput & {
  kind: 'pinch';
  scale: number;
  origin?: PointInput;
};

export type RotateInput = CommonCommandInput & {
  kind: 'rotate';
  degrees: number;
  origin?: PointInput;
  velocity?: number;
};

export type TransformInput = CommonCommandInput & {
  kind: 'transform';
  origin: PointInput;
  delta: PointInput;
  scale: number;
  degrees: number;
  durationMs?: number;
};

export type GestureInput = PanInput | FlingInput | PinchInput | RotateInput | TransformInput;

export const interactionCommandMetadata = [
  defineCommandMetadata({
    name: 'click',
    description: requireCommandDescription('click'),
    inputSchema: fieldsInputSchema(clickFields),
    readInput: (input) => readFieldInput(input, clickFields),
  }),
  defineCommandMetadata({
    name: 'press',
    description: requireCommandDescription('press'),
    inputSchema: fieldsInputSchema(pressFields),
    readInput: (input) => readFieldInput(input, pressFields),
  }),
  defineCommandMetadata({
    name: 'fill',
    description: requireCommandDescription('fill'),
    inputSchema: fieldsInputSchema(fillFields),
    readInput: (input) => readFieldInput(input, fillFields),
  }),
  defineInteractionCommandMetadata('longpress', longPressFields),
  defineInteractionCommandMetadata('swipe', swipeFields),
  defineInteractionCommandMetadata('focus', focusFields),
  defineInteractionCommandMetadata('type', typeFields),
  defineInteractionCommandMetadata('scroll', scrollFields),
  defineInteractionCommandMetadata('get', getFields),
  defineInteractionCommandMetadata('is', isFields),
  defineInteractionCommandMetadata('find', findFields),
  defineCommandMetadata({
    name: 'gesture',
    description: requireCommandDescription('gesture'),
    inputSchema: fieldsInputSchema(gestureFields),
    readInput: readGestureInput,
  }),
] as const;

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

function defineInteractionCommandMetadata<
  const TName extends string,
  const TFields extends CommandFieldMap,
>(name: TName, fields: TFields) {
  return defineFieldCommandMetadata(name, requireCommandDescription(name), fields);
}

function optionalPoint(record: Record<string, unknown>, key: string): PointInput | undefined {
  return record[key] === undefined ? undefined : readPoint(record, key);
}
