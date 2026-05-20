import { describe, expect, test } from 'vitest';
import {
  detectReactNativeOverlay,
  formatReactNativeOverlayWarning,
  resolveReactNativeOverlayDismissTarget,
} from '../react-native-overlay.ts';
import type { SnapshotNode } from '../snapshot.ts';

describe('React Native overlay helpers', () => {
  test('targets the trailing close affordance for collapsed warning banners', () => {
    const nodes = [
      node({
        ref: 'e90',
        label: '!, Open debugger to view warnings.',
        rect: { x: 0, y: 794, width: 402, height: 52 },
        hittable: true,
      }),
    ];

    const target = resolveReactNativeOverlayDismissTarget(nodes);

    expect(target).toMatchObject({
      action: 'close-collapsed-banner',
      ref: 'e90',
      point: { x: 379, y: 820 },
    });
  });

  test('prefers Minimize for RedBox overlays', () => {
    const nodes = [
      node({ ref: 'e1', label: 'Runtime Error', rect: { x: 0, y: 0, width: 390, height: 100 } }),
      node({ ref: 'e2', label: 'Dismiss', rect: { x: 20, y: 730, width: 150, height: 44 } }),
      node({ ref: 'e3', label: 'Minimize', rect: { x: 190, y: 730, width: 150, height: 44 } }),
    ];

    const target = resolveReactNativeOverlayDismissTarget(nodes);

    expect(target).toMatchObject({
      action: 'minimize',
      ref: 'e3',
      point: { x: 265, y: 752 },
    });
  });

  test('formats snapshot warning around the overlay command', () => {
    const nodes = [
      node({
        ref: 'e12',
        label: '!, Open debugger to view warnings.',
        rect: { x: 0, y: 794, width: 402, height: 52 },
      }),
    ];

    const warning = formatReactNativeOverlayWarning(nodes);

    expect(detectReactNativeOverlay(nodes).detected).toBe(true);
    expect(warning).toContain('agent-device react-native dismiss-overlay');
    expect(warning).toContain('do not press the collapsed warning banner body manually');
  });
});

function node(partial: Partial<SnapshotNode> & Pick<SnapshotNode, 'ref'>): SnapshotNode {
  const { ref, ...rest } = partial;
  return {
    index: 0,
    ref,
    ...rest,
  };
}
