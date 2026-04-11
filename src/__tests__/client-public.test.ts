import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  createAgentDeviceClient,
  type AgentDeviceClient,
  type CaptureScreenshotResult,
  type CaptureSnapshotResult,
  type Point,
  type Rect,
  type ScreenshotOverlayRef,
  type SnapshotNode,
  type SnapshotVisibility,
  type SnapshotVisibilityReason,
} from '../index.ts';

const rect = { x: 1, y: 2, width: 3, height: 4 } satisfies Rect;
const point = { x: 2, y: 4 } satisfies Point;
const visibilityReason = 'offscreen-nodes' satisfies SnapshotVisibilityReason;

const node = {
  index: 0,
  ref: 'e1',
  type: 'Button',
  label: 'Continue',
  rect,
} satisfies SnapshotNode;

const visibility = {
  partial: true,
  visibleNodeCount: 1,
  totalNodeCount: 2,
  reasons: [visibilityReason],
} satisfies SnapshotVisibility;

({
  nodes: [node],
  truncated: false,
  visibility,
  identifiers: { session: 'default' },
}) satisfies CaptureSnapshotResult;

const overlay = {
  ref: 'e1',
  rect,
  overlayRect: rect,
  center: point,
} satisfies ScreenshotOverlayRef;

({
  path: '/tmp/screenshot.png',
  overlayRefs: [overlay],
  identifiers: { session: 'default' },
}) satisfies CaptureScreenshotResult;

test('package root exports createAgentDeviceClient', () => {
  const client: AgentDeviceClient = createAgentDeviceClient();
  assert.equal(typeof client.capture.snapshot, 'function');
});
