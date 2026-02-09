import test from 'node:test';
import assert from 'node:assert/strict';
import { findBounds, parseUiHierarchy } from '../index.ts';

test('parseUiHierarchy reads double-quoted Android node attributes', () => {
  const xml =
    '<hierarchy><node class="android.widget.TextView" text="Hello" content-desc="Greeting" resource-id="com.demo:id/title" bounds="[10,20][110,60]" clickable="true" enabled="true"/></hierarchy>';

  const result = parseUiHierarchy(xml, 800, { raw: true });
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].value, 'Hello');
  assert.equal(result.nodes[0].label, 'Hello');
  assert.equal(result.nodes[0].identifier, 'com.demo:id/title');
  assert.deepEqual(result.nodes[0].rect, { x: 10, y: 20, width: 100, height: 40 });
  assert.equal(result.nodes[0].hittable, true);
  assert.equal(result.nodes[0].enabled, true);
});

test('parseUiHierarchy reads single-quoted Android node attributes', () => {
  const xml =
    "<hierarchy><node class='android.widget.TextView' text='Hello' content-desc='Greeting' resource-id='com.demo:id/title' bounds='[10,20][110,60]' clickable='true' enabled='true'/></hierarchy>";

  const result = parseUiHierarchy(xml, 800, { raw: true });
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].value, 'Hello');
  assert.equal(result.nodes[0].label, 'Hello');
  assert.equal(result.nodes[0].identifier, 'com.demo:id/title');
  assert.deepEqual(result.nodes[0].rect, { x: 10, y: 20, width: 100, height: 40 });
  assert.equal(result.nodes[0].hittable, true);
  assert.equal(result.nodes[0].enabled, true);
});

test('parseUiHierarchy supports mixed quote styles in one node', () => {
  const xml =
    '<hierarchy><node class="android.widget.TextView" text=\'Hello\' content-desc="Greeting" resource-id=\'com.demo:id/title\' bounds="[10,20][110,60]"/></hierarchy>';

  const result = parseUiHierarchy(xml, 800, { raw: true });
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].value, 'Hello');
  assert.equal(result.nodes[0].label, 'Hello');
  assert.equal(result.nodes[0].identifier, 'com.demo:id/title');
});

test('findBounds supports single and double quoted attributes', () => {
  const xml = [
    '<hierarchy>',
    '<node text="Nothing" content-desc="Irrelevant" bounds="[0,0][10,10]"/>',
    "<node text='Target from single quote' content-desc='Alt single' bounds='[100,200][300,500]'/>",
    '<node text="Target from double quote" content-desc="Alt double" bounds="[50,50][150,250]"/>',
    '</hierarchy>',
  ].join('');

  assert.deepEqual(findBounds(xml, 'single quote'), { x: 200, y: 350 });
  assert.deepEqual(findBounds(xml, 'alt double'), { x: 100, y: 150 });
});
