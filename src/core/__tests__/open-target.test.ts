import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepLinkTarget } from '../open-target.ts';

test('isDeepLinkTarget accepts URL-style deep links', () => {
  assert.equal(isDeepLinkTarget('myapp://home'), true);
  assert.equal(isDeepLinkTarget('https://example.com'), true);
  assert.equal(isDeepLinkTarget('tel:123456789'), true);
  assert.equal(isDeepLinkTarget('mailto:test@example.com'), true);
});

test('isDeepLinkTarget rejects app identifiers and malformed URLs', () => {
  assert.equal(isDeepLinkTarget('com.example.app'), false);
  assert.equal(isDeepLinkTarget('settings'), false);
  assert.equal(isDeepLinkTarget('http:/x'), false);
});
