import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { buildArkUiSnapshot, type ArkUiTree } from '../arkui-hierarchy.ts';

describe('HarmonyOS ArkUI hierarchy', () => {
  it('filters interactiveOnly output to interactive context', () => {
    const tree: ArkUiTree = [
      {
        attributes: { type: 'root' },
        children: [
          {
            attributes: { type: 'Text', text: 'Title only' },
          },
          {
            attributes: { type: 'List', scrollable: 'true', id: 'feed' },
            children: [
              {
                attributes: { type: 'Text', text: 'Item title' },
              },
              {
                attributes: { type: 'Button', text: 'Open', clickable: 'true' },
              },
            ],
          },
          {
            attributes: { type: 'Text', text: 'Footer only' },
          },
        ],
      },
    ];

    const result = buildArkUiSnapshot(tree, 100, { interactiveOnly: true });
    const labels = result.nodes.map((node) => node.label).filter(Boolean);
    const identifiers = result.nodes.map((node) => node.identifier).filter(Boolean);

    assert.deepEqual(labels, ['Item title', 'Open']);
    assert.deepEqual(identifiers, ['feed']);
  });

  it('when a focused modal exists, interactiveOnly scopes to it', () => {
    const tree: ArkUiTree = [
      {
        attributes: { type: 'root' },
        children: [
          {
            attributes: { type: 'Column' },
            children: [
              { attributes: { type: 'Text', text: '微信登录' } },
              { attributes: { type: 'Text', text: '其他登录方式' } },
              { attributes: { type: 'Button', text: '背景按钮', clickable: 'true' } },
            ],
          },
          {
            attributes: { type: 'NavDestination', focused: 'true' },
            children: [
              { attributes: { type: 'Text', text: '请阅读并同意以下条款' } },
              { attributes: { type: 'Button', text: '不同意', clickable: 'true' } },
              { attributes: { type: 'Button', text: '同意并继续', clickable: 'true' } },
            ],
          },
        ],
      },
    ];

    const result = buildArkUiSnapshot(tree, 100, { interactiveOnly: true });
    const labels = result.nodes.map((node) => node.label).filter(Boolean);

    assert.ok(labels.includes('同意并继续'));
    assert.ok(labels.includes('不同意'));
    assert.ok(labels.includes('请阅读并同意以下条款'));
    assert.ok(!labels.includes('背景按钮'));
    assert.ok(!labels.includes('微信登录'));
    assert.ok(!labels.includes('其他登录方式'));
  });
});
