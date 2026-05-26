import { test, expect } from 'vitest';
import { parseFillTarget, parseTouchTarget } from '../interaction-touch-targets.ts';

test('parseTouchTarget preserves ref fallback label through shared target codec', () => {
  const parsed = parseTouchTarget(['@e4', 'Email field'], 'press');

  expect(parsed).toEqual({
    ok: true,
    target: {
      kind: 'ref',
      ref: '@e4',
      fallbackLabel: 'Email field',
    },
  });
});

test('parseTouchTarget trims ref fallback label', () => {
  const parsed = parseTouchTarget(['@e4', '  Email field  '], 'press');

  expect(parsed).toEqual({
    ok: true,
    target: {
      kind: 'ref',
      ref: '@e4',
      fallbackLabel: 'Email field',
    },
  });
});

test('parseTouchTarget keeps invalid coordinates as selector text', () => {
  const parsed = parseTouchTarget(['12', 'not-y'], 'press');

  expect(parsed).toEqual({
    ok: true,
    target: {
      kind: 'selector',
      selector: '12 not-y',
    },
  });
});

test('parseFillTarget reads selector text through shared fill codec', () => {
  const parsed = parseFillTarget(['label="Email"', 'qa@example.com']);

  expect(parsed).toEqual({
    ok: true,
    target: {
      kind: 'selector',
      selector: 'label="Email"',
    },
    text: 'qa@example.com',
  });
});

test('parseFillTarget preserves selector text whitespace', () => {
  const parsed = parseFillTarget(['label="Command"', 'submit\n']);

  expect(parsed).toEqual({
    ok: true,
    target: {
      kind: 'selector',
      selector: 'label="Command"',
    },
    text: 'submit\n',
  });
});

test('parseFillTarget rejects invalid coordinates instead of treating them as a point', () => {
  const parsed = parseFillTarget(['10', 'not-y', 'text']);

  expect(parsed.ok).toBe(false);
  if (!parsed.ok) {
    expect(parsed.response.ok).toBe(false);
    if (!parsed.response.ok) {
      expect(parsed.response.error.message).toBe(
        'fill requires x y text, @ref text, or selector text',
      );
    }
  }
});
