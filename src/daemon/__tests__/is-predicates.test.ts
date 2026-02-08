import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateIsPredicate, isSupportedPredicate } from '../is-predicates.ts';

const baseNode = {
  ref: 'e1',
  index: 0,
  type: 'XCUIElementTypeTextField',
  label: 'Email',
  value: '',
  identifier: 'login_email',
  rect: { x: 0, y: 0, width: 100, height: 40 },
  enabled: true,
  hittable: true,
};

test('isSupportedPredicate validates supported predicates', () => {
  assert.equal(isSupportedPredicate('visible'), true);
  assert.equal(isSupportedPredicate('text'), true);
  assert.equal(isSupportedPredicate('checked'), false);
});

test('evaluateIsPredicate visible and hidden', () => {
  const visible = evaluateIsPredicate({
    predicate: 'visible',
    node: baseNode,
    platform: 'ios',
  });
  const hidden = evaluateIsPredicate({
    predicate: 'hidden',
    node: { ...baseNode, rect: { ...baseNode.rect, width: 0 }, hittable: false },
    platform: 'ios',
  });
  assert.equal(visible.pass, true);
  assert.equal(hidden.pass, true);
});

test('evaluateIsPredicate editable and selected', () => {
  const editable = evaluateIsPredicate({
    predicate: 'editable',
    node: baseNode,
    platform: 'ios',
  });
  const selected = evaluateIsPredicate({
    predicate: 'selected',
    node: { ...baseNode, selected: true },
    platform: 'ios',
  });
  assert.equal(editable.pass, true);
  assert.equal(selected.pass, true);
});

test('evaluateIsPredicate text uses equality', () => {
  const match = evaluateIsPredicate({
    predicate: 'text',
    node: baseNode,
    expectedText: 'Email',
    platform: 'ios',
  });
  const mismatch = evaluateIsPredicate({
    predicate: 'text',
    node: baseNode,
    expectedText: 'email',
    platform: 'ios',
  });
  assert.equal(match.pass, true);
  assert.equal(mismatch.pass, false);
});
