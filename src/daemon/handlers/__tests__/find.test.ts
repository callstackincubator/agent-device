import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFindArgs } from '../find.ts';
import { AppError } from '../../../utils/errors.ts';

test('parseFindArgs defaults to click with any locator', () => {
  const parsed = parseFindArgs(['Login']);
  assert.equal(parsed.locator, 'any');
  assert.equal(parsed.query, 'Login');
  assert.equal(parsed.action, 'click');
});

test('parseFindArgs supports explicit locator and fill payload', () => {
  const parsed = parseFindArgs(['label', 'Email', 'fill', 'user@example.com']);
  assert.equal(parsed.locator, 'label');
  assert.equal(parsed.query, 'Email');
  assert.equal(parsed.action, 'fill');
  assert.equal(parsed.value, 'user@example.com');
});

test('parseFindArgs parses wait timeout', () => {
  const parsed = parseFindArgs(['text', 'Settings', 'wait', '2500']);
  assert.equal(parsed.locator, 'text');
  assert.equal(parsed.action, 'wait');
  assert.equal(parsed.timeoutMs, 2500);
});

test('parseFindArgs parses get text', () => {
  const parsed = parseFindArgs(['label', 'Price', 'get', 'text']);
  assert.equal(parsed.locator, 'label');
  assert.equal(parsed.query, 'Price');
  assert.equal(parsed.action, 'get_text');
});

test('parseFindArgs parses get attrs', () => {
  const parsed = parseFindArgs(['id', 'btn-1', 'get', 'attrs']);
  assert.equal(parsed.locator, 'id');
  assert.equal(parsed.query, 'btn-1');
  assert.equal(parsed.action, 'get_attrs');
});

test('parseFindArgs rejects invalid get sub-action', () => {
  assert.throws(
    () => parseFindArgs(['text', 'Settings', 'get', 'foo']),
    (err: unknown) =>
      err instanceof AppError &&
      err.code === 'INVALID_ARGS' &&
      err.message.includes('find get only supports text or attrs'),
  );
});

test('parseFindArgs parses type action with value', () => {
  const parsed = parseFindArgs(['label', 'Name', 'type', 'Jane']);
  assert.equal(parsed.locator, 'label');
  assert.equal(parsed.query, 'Name');
  assert.equal(parsed.action, 'type');
  assert.equal(parsed.value, 'Jane');
});

test('parseFindArgs joins multi-word fill value', () => {
  const parsed = parseFindArgs(['label', 'Bio', 'fill', 'hello', 'world']);
  assert.equal(parsed.action, 'fill');
  assert.equal(parsed.value, 'hello world');
});

test('parseFindArgs joins multi-word type value', () => {
  const parsed = parseFindArgs(['label', 'Bio', 'type', 'hello', 'world']);
  assert.equal(parsed.action, 'type');
  assert.equal(parsed.value, 'hello world');
});

test('parseFindArgs wait without timeout leaves timeoutMs undefined', () => {
  const parsed = parseFindArgs(['text', 'Loading', 'wait']);
  assert.equal(parsed.action, 'wait');
  assert.equal(parsed.timeoutMs, undefined);
});

test('parseFindArgs wait with non-numeric timeout leaves timeoutMs undefined', () => {
  const parsed = parseFindArgs(['text', 'Loading', 'wait', 'abc']);
  assert.equal(parsed.action, 'wait');
  assert.equal(parsed.timeoutMs, undefined);
});

test('parseFindArgs throws on unsupported action', () => {
  assert.throws(
    () => parseFindArgs(['text', 'OK', 'swipe']),
    (err: unknown) =>
      err instanceof AppError &&
      err.code === 'INVALID_ARGS' &&
      err.message.includes('Unsupported find action: swipe'),
  );
});

test('parseFindArgs with bare locator yields empty query', () => {
  const parsed = parseFindArgs(['text']);
  assert.equal(parsed.locator, 'text');
  assert.equal(parsed.query, '');
  assert.equal(parsed.action, 'click');
});
