import { expect, test } from 'vitest';
import { parseFindArgs } from '../find.ts';

test('parseFindArgs defaults to click with any locator', () => {
  const parsed = parseFindArgs(['Login']);
  expect(parsed.locator).toBe('any');
  expect(parsed.query).toBe('Login');
  expect(parsed.action).toBe('click');
});

test('parseFindArgs supports explicit locator and fill payload', () => {
  const parsed = parseFindArgs(['label', 'Email', 'fill', 'user@example.com']);
  expect(parsed.locator).toBe('label');
  expect(parsed.query).toBe('Email');
  expect(parsed.action).toBe('fill');
  expect(parsed.value).toBe('user@example.com');
});

test('parseFindArgs parses wait timeout', () => {
  const parsed = parseFindArgs(['text', 'Settings', 'wait', '2500']);
  expect(parsed.locator).toBe('text');
  expect(parsed.action).toBe('wait');
  expect(parsed.timeoutMs).toBe(2500);
});

test('parseFindArgs parses get text', () => {
  const parsed = parseFindArgs(['label', 'Price', 'get', 'text']);
  expect(parsed.locator).toBe('label');
  expect(parsed.query).toBe('Price');
  expect(parsed.action).toBe('get_text');
});

test('parseFindArgs parses get attrs', () => {
  const parsed = parseFindArgs(['id', 'btn-1', 'get', 'attrs']);
  expect(parsed.locator).toBe('id');
  expect(parsed.query).toBe('btn-1');
  expect(parsed.action).toBe('get_attrs');
});

test('parseFindArgs rejects invalid get sub-action', () => {
  expect(() => parseFindArgs(['text', 'Settings', 'get', 'foo'])).toThrow(
    expect.objectContaining({
      code: 'INVALID_ARGS',
      message: expect.stringContaining('find get only supports text or attrs'),
    }),
  );
});

test('parseFindArgs parses type action with value', () => {
  const parsed = parseFindArgs(['label', 'Name', 'type', 'Jane']);
  expect(parsed.locator).toBe('label');
  expect(parsed.query).toBe('Name');
  expect(parsed.action).toBe('type');
  expect(parsed.value).toBe('Jane');
});

test('parseFindArgs joins multi-word fill value', () => {
  const parsed = parseFindArgs(['label', 'Bio', 'fill', 'hello', 'world']);
  expect(parsed.action).toBe('fill');
  expect(parsed.value).toBe('hello world');
});

test('parseFindArgs joins multi-word type value', () => {
  const parsed = parseFindArgs(['label', 'Bio', 'type', 'hello', 'world']);
  expect(parsed.action).toBe('type');
  expect(parsed.value).toBe('hello world');
});

test('parseFindArgs wait without timeout leaves timeoutMs undefined', () => {
  const parsed = parseFindArgs(['text', 'Loading', 'wait']);
  expect(parsed.action).toBe('wait');
  expect(parsed.timeoutMs).toBeUndefined();
});

test('parseFindArgs wait with non-numeric timeout leaves timeoutMs undefined', () => {
  const parsed = parseFindArgs(['text', 'Loading', 'wait', 'abc']);
  expect(parsed.action).toBe('wait');
  expect(parsed.timeoutMs).toBeUndefined();
});

test('parseFindArgs throws on unsupported action', () => {
  expect(() => parseFindArgs(['text', 'OK', 'swipe'])).toThrow(
    expect.objectContaining({
      code: 'INVALID_ARGS',
      message: expect.stringContaining('Unsupported find action: swipe'),
    }),
  );
});

test('parseFindArgs with bare locator yields empty query', () => {
  const parsed = parseFindArgs(['text']);
  expect(parsed.locator).toBe('text');
  expect(parsed.query).toBe('');
  expect(parsed.action).toBe('click');
});
