import { describe, expect, test } from 'vitest';
import {
  detectReactNativeOverlay,
  formatReactNativeOverlayWarning,
  resolveReactNativeOverlayDismissTarget,
} from '../overlay.ts';
import type { SnapshotNode } from '../../../utils/snapshot.ts';

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

  test('targets visible close affordance when collapsed banner keeps outer bounds', () => {
    const nodes = [
      node({
        ref: 'e3',
        label: '!, Open debugger to view warnings.',
        rect: { x: 0, y: 0, width: 402, height: 874 },
        hittable: false,
      }),
      node({
        ref: 'e125',
        label: '!, Open debugger to view warnings.',
        rect: { x: 10, y: 786.666, width: 382, height: 67.333 },
        hittable: false,
      }),
    ];

    const target = resolveReactNativeOverlayDismissTarget(nodes);

    expect(detectReactNativeOverlay(nodes).detected).toBe(true);
    expect(target).toMatchObject({
      action: 'close-collapsed-banner',
      ref: 'e125',
      point: { x: 369, y: 813 },
    });
  });

  test('detects full-screen open-debugger wrappers but does not use them as targets', () => {
    const nodes = [
      node({
        ref: 'e3',
        label: '!, Open debugger to view warnings.',
        rect: { x: 0, y: 0, width: 402, height: 874 },
        hittable: false,
      }),
    ];

    expect(detectReactNativeOverlay(nodes).detected).toBe(true);
    expect(resolveReactNativeOverlayDismissTarget(nodes)).toBeNull();
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

  test('falls back to Dismiss for RedBox overlays without Minimize', () => {
    const nodes = [
      node({ ref: 'e1', label: 'Runtime Error', rect: { x: 0, y: 0, width: 390, height: 100 } }),
      node({ ref: 'e2', label: 'Dismiss', rect: { x: 20, y: 730, width: 150, height: 44 } }),
    ];

    const target = resolveReactNativeOverlayDismissTarget(nodes);

    expect(target).toMatchObject({
      action: 'dismiss',
      ref: 'e2',
      point: { x: 95, y: 752 },
      warning: 'RedBox Minimize control was not exposed; used Dismiss fallback',
    });
  });

  test('does not detect app copy that mentions React Native overlay terms without controls', () => {
    const nodes = [
      node({
        ref: 'e1',
        label: 'Runtime error troubleshooting docs mention LogBox and RedBox',
        rect: { x: 0, y: 100, width: 390, height: 80 },
      }),
    ];

    expect(detectReactNativeOverlay(nodes).detected).toBe(false);
    expect(resolveReactNativeOverlayDismissTarget(nodes)).toBeNull();
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
    expect(warning).toBe(
      [
        'Hint: React Native warning/error overlay detected. It overlays part of the app and should be handled before interacting.',
        'Run: agent-device react-native dismiss-overlay',
        'Then run: agent-device snapshot -i -c',
        'Use refs from the new snapshot.',
      ].join('\n'),
    );
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
