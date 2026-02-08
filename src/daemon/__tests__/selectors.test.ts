import test from 'node:test';
import assert from 'node:assert/strict';
import type { SnapshotState } from '../../utils/snapshot.ts';
import {
  buildSelectorChainForNode,
  findSelectorChainMatch,
  isSelectorToken,
  parseSelectorChain,
  resolveSelectorChain,
  splitSelectorFromArgs,
} from '../selectors.ts';

const nodes: SnapshotState['nodes'] = [
  {
    ref: 'e1',
    index: 0,
    type: 'XCUIElementTypeTextField',
    label: 'Email',
    value: '',
    identifier: 'login_email',
    rect: { x: 0, y: 0, width: 200, height: 44 },
    enabled: true,
    hittable: true,
  },
  {
    ref: 'e2',
    index: 1,
    type: 'XCUIElementTypeButton',
    label: 'Continue',
    identifier: 'auth_continue',
    rect: { x: 0, y: 80, width: 200, height: 44 },
    enabled: true,
    hittable: true,
  },
  {
    ref: 'e3',
    index: 2,
    type: 'XCUIElementTypeButton',
    label: 'Continue',
    identifier: 'secondary_continue',
    rect: { x: 0, y: 140, width: 200, height: 44 },
    enabled: true,
    hittable: true,
  },
];

test('parseSelectorChain parses fallback and boolean terms', () => {
  const chain = parseSelectorChain('id=auth_continue || role=button label="Continue" visible=true');
  assert.equal(chain.selectors.length, 2);
  assert.equal(chain.selectors[0].terms[0].key, 'id');
  assert.equal(chain.selectors[1].terms[2].key, 'visible');
});

test('resolveSelectorChain resolves unique match', () => {
  const chain = parseSelectorChain('id=login_email');
  const resolved = resolveSelectorChain(nodes, chain, {
    platform: 'ios',
    requireRect: true,
    requireUnique: true,
  });
  assert.ok(resolved);
  assert.equal(resolved.node.ref, 'e1');
});

test('resolveSelectorChain falls back when first selector is ambiguous', () => {
  const chain = parseSelectorChain('label="Continue" || id=auth_continue');
  const resolved = resolveSelectorChain(nodes, chain, {
    platform: 'ios',
    requireRect: true,
    requireUnique: true,
  });
  assert.ok(resolved);
  assert.equal(resolved.selectorIndex, 1);
  assert.equal(resolved.node.ref, 'e2');
});

test('findSelectorChainMatch returns first matching selector for existence checks', () => {
  const chain = parseSelectorChain('label="Continue" || id=auth_continue');
  const match = findSelectorChainMatch(nodes, chain, {
    platform: 'ios',
  });
  assert.ok(match);
  assert.equal(match.selectorIndex, 0);
  assert.equal(match.matches, 2);
});

test('splitSelectorFromArgs extracts selector prefix and trailing value', () => {
  const split = splitSelectorFromArgs(['id=login_email', 'editable=true', 'qa@example.com']);
  assert.ok(split);
  assert.equal(split.selectorExpression, 'id=login_email editable=true');
  assert.deepEqual(split.rest, ['qa@example.com']);
});

test('parseSelectorChain rejects unknown keys and malformed quotes', () => {
  assert.throws(() => parseSelectorChain('foo=bar'), /Unknown selector key/i);
  assert.throws(() => parseSelectorChain('label="unclosed'), /Unclosed quote/i);
  assert.throws(() => parseSelectorChain(''), /cannot be empty/i);
});

test('isSelectorToken only accepts known keys for key=value tokens', () => {
  assert.equal(isSelectorToken('id=foo'), true);
  assert.equal(isSelectorToken('editable=true'), true);
  assert.equal(isSelectorToken('foo=bar'), false);
  assert.equal(isSelectorToken('a=b'), false);
});

test('text selector matches extractNodeText semantics (first non-empty field)', () => {
  const chainByLabel = parseSelectorChain('text=Email');
  const chainById = parseSelectorChain('text=login_email');
  const resolvedLabel = resolveSelectorChain(nodes, chainByLabel, {
    platform: 'ios',
    requireUnique: true,
  });
  const resolvedId = resolveSelectorChain(nodes, chainById, {
    platform: 'ios',
    requireUnique: true,
  });
  assert.ok(resolvedLabel);
  assert.equal(resolvedLabel.node.ref, 'e1');
  assert.equal(resolvedId, null);
});

test('buildSelectorChainForNode prefers id and adds editable for fill action', () => {
  const target = nodes[0];
  const chain = buildSelectorChainForNode(target, 'ios', { action: 'fill' });
  assert.ok(chain.some((entry) => entry.includes('id=')));
  assert.ok(chain.some((entry) => entry.includes('editable=true')));
});
