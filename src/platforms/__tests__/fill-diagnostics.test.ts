import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildFillFailureDetails } from '../fill-diagnostics.ts';

test('buildFillFailureDetails redacts masked expected and node text', () => {
  const details = buildFillFailureDetails('Secret123', {
    ok: false,
    actual: 'secret-value',
    reason: 'masked_unverified',
    masked: true,
    targetInput: {
      text: 'secret-value',
      password: true,
      focused: true,
    },
    actualInput: {
      text: '••••••',
      focused: true,
    },
  });

  assert.equal(details.expected, undefined);
  assert.equal(details.expectedLength, 9);
  assert.equal(details.actual, null);
  assert.equal(details.actualLength, 12);
  assert.equal(details.targetInput?.text, null);
  assert.equal(details.targetInput?.textRedacted, true);
  assert.equal(details.actualInput?.text, null);
  assert.equal(details.actualInput?.textRedacted, true);
  assert.doesNotMatch(JSON.stringify(details), /Secret123|secret-value|••••••/);
});

test('buildFillFailureDetails keeps non-masked text diagnostics visible', () => {
  const details = buildFillFailureDetails('search term', {
    ok: false,
    actual: 'search',
    reason: 'text_mismatch',
    targetInput: { text: 'Search Products', focused: false },
    actualInput: { text: 'search', focused: true },
  });

  assert.equal(details.expected, 'search term');
  assert.equal(details.actual, 'search');
  assert.equal(details.targetInput?.text, 'Search Products');
  assert.equal(details.actualInput?.text, 'search');
});

test('buildFillFailureDetails infers sensitivity from password nodes', () => {
  const details = buildFillFailureDetails('Secret123', {
    ok: false,
    actual: 'secret-value',
    reason: 'text_mismatch',
    targetInput: { text: 'secret-value', password: true },
    actualInput: { text: 'secret-value', password: true },
  });

  assert.equal(details.expected, undefined);
  assert.equal(details.expectedLength, 9);
  assert.equal(details.actual, null);
  assert.equal(details.actualInput?.textRedacted, true);
  assert.doesNotMatch(JSON.stringify(details), /Secret123|secret-value/);
});

test('buildFillFailureDetails redacts common masked field glyphs', () => {
  for (const actual of ['••••', '****', '●●●']) {
    const details = buildFillFailureDetails('Secret123', {
      ok: false,
      actual,
      reason: 'masked_unverified',
      targetInput: { text: 'Search Products' },
      actualInput: { text: actual, focused: true },
    });

    assert.equal(details.expected, undefined);
    assert.equal(details.actual, null);
    assert.equal(details.actualInput?.textRedacted, true);
    assert.doesNotMatch(JSON.stringify(details), /Secret123|\*|•|●/);
  }
});
