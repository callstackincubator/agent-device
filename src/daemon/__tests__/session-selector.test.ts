import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSessionSelectorMatches } from '../session-selector.ts';
import { AppError } from '../../utils/errors.ts';
import type { SessionState } from '../types.ts';

function makeSession(overrides?: Partial<SessionState>): SessionState {
  return {
    name: 'default',
    device: {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel 9',
      kind: 'emulator',
      booted: true,
    },
    createdAt: Date.now(),
    actions: [],
    ...overrides,
  };
}

test('accepts matching platform and serial selectors', () => {
  const session = makeSession();
  assert.doesNotThrow(() =>
    assertSessionSelectorMatches(session, {
      platform: 'android',
      serial: 'emulator-5554',
    }),
  );
});

test('rejects mismatched platform selector', () => {
  const session = makeSession();
  assert.throws(
    () => assertSessionSelectorMatches(session, { platform: 'ios' }),
    (err: unknown) =>
      err instanceof AppError &&
      err.code === 'INVALID_ARGS' &&
      err.message.includes('--platform=ios'),
  );
});

test('rejects mismatched serial selector', () => {
  const session = makeSession();
  assert.throws(
    () => assertSessionSelectorMatches(session, { serial: 'emulator-9999' }),
    (err: unknown) =>
      err instanceof AppError &&
      err.code === 'INVALID_ARGS' &&
      err.message.includes('--serial=emulator-9999'),
  );
});

test('rejects udid selector for android session', () => {
  const session = makeSession();
  assert.throws(
    () => assertSessionSelectorMatches(session, { udid: 'ABC-123' }),
    (err: unknown) =>
      err instanceof AppError &&
      err.code === 'INVALID_ARGS' &&
      err.message.includes('--udid=ABC-123'),
  );
});

test('accepts matching device selector (case-insensitive)', () => {
  const session = makeSession();
  assert.doesNotThrow(() =>
    assertSessionSelectorMatches(session, {
      device: 'pixel 9',
    }),
  );
});

test('rejects mismatched device selector', () => {
  const session = makeSession();
  assert.throws(
    () => assertSessionSelectorMatches(session, { device: 'thymikee-iphone' }),
    (err: unknown) =>
      err instanceof AppError &&
      err.code === 'INVALID_ARGS' &&
      err.message.includes('--device=thymikee-iphone'),
  );
});
