import type { DeviceInfo } from '../../utils/device.ts';
import type { Point, Rect } from '../../utils/snapshot.ts';
import { runHarmonyHdc } from './hdc.ts';
import { buildScrollGesturePlan, type ScrollDirection } from '../../core/scroll-gesture.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceRotation } from '../../core/device-rotation.ts';

export async function pressHarmony(device: DeviceInfo, x: number, y: number): Promise<void> {
  await runHarmonyHdc(device, ['shell', 'uitest', 'uiInput', 'click', String(x), String(y)]);
}

export async function doubleTapHarmony(device: DeviceInfo, x: number, y: number): Promise<void> {
  // Use uitest native doubleClick command
  await runHarmonyHdc(device, ['shell', 'uitest', 'uiInput', 'doubleClick', String(x), String(y)]);
}

export async function rotateHarmony(device: DeviceInfo, orientation: DeviceRotation): Promise<void> {
  // HarmonyOS rotation via hidumper setting to DisplayManagerService
  // Orientation values: 0 = portrait, 1 = landscape-left, 2 = portrait-upside-down, 3 = landscape-right
  const rotationValue = mapRotationToValue(orientation);

  // Try using hidumper to set rotation
  const result = await runHarmonyHdc(
    device,
    ['shell', 'hidumper', '-s', 'DisplayManagerService', '-a', `SetScreenRotation ${rotationValue}`],
    { allowFailure: true, timeoutMs: 10_000 },
  );

  if (result.exitCode !== 0 || result.stderr.includes('error')) {
    // Fallback: try param set
    const paramResult = await runHarmonyHdc(
      device,
      ['shell', 'param', 'set', 'persist.sys.display.orientation', String(rotationValue)],
      { allowFailure: true, timeoutMs: 10_000 },
    );

    if (paramResult.exitCode !== 0) {
      throw new AppError(
        'UNSUPPORTED_OPERATION',
        'HarmonyOS screen rotation requires system-level permissions. Rotation control is not available via HDC.',
      );
    }
  }
}

function mapRotationToValue(orientation: DeviceRotation): number {
  switch (orientation) {
    case 'portrait':
      return 0;
    case 'landscape-left':
      return 1;
    case 'portrait-upside-down':
      return 2;
    case 'landscape-right':
      return 3;
    default:
      return 0;
  }
}

export async function getHarmonyKeyboardState(
  device: DeviceInfo,
): Promise<{ visible: boolean; height?: number }> {
  // Check keyboard visibility via WindowManagerService dump
  const result = await runHarmonyHdc(
    device,
    ['shell', 'hidumper', '-s', 'WindowManagerService', '-a', '-a'],
    { allowFailure: true, timeoutMs: 10_000 },
  );

  if (result.exitCode !== 0) {
    return { visible: false };
  }

  // Look for softKeyboard window with non-zero height
  const lines = result.stdout.split('\n');
  for (const line of lines) {
    if (line.includes('softKeyboard') || line.includes('Keyboard')) {
      // Parse the window rect [ x y w h ]
      const rectMatch = line.match(/\[\s*\d+\s+\d+\s+\d+\s+(\d+)\s*\]/);
      if (rectMatch) {
        const height = Number(rectMatch[1]);
        if (height > 0) {
          return { visible: true, height };
        }
      }
    }
  }

  return { visible: false };
}

export async function dismissHarmonyKeyboard(device: DeviceInfo): Promise<void> {
  // Dismiss keyboard by pressing Back key
  await pressBackHarmony(device);
}

export async function longPressHarmony(
  device: DeviceInfo,
  x: number,
  y: number,
  durationMs: number = 1000,
): Promise<void> {
  // Long press = swipe to same point with duration
  await runHarmonyHdc(device, [
    'shell',
    'uitest',
    'uiInput',
    'swipe',
    String(x),
    String(y),
    String(x),
    String(y),
    String(durationMs),
  ]);
}

export async function swipeHarmony(
  device: DeviceInfo,
  from: Point,
  to: Point,
  durationMs?: number,
): Promise<void> {
  const args = [
    'shell',
    'uitest',
    'uiInput',
    'swipe',
    String(from.x),
    String(from.y),
    String(to.x),
    String(to.y),
  ];
  if (durationMs !== undefined) {
    args.push(String(durationMs));
  }
  await runHarmonyHdc(device, args);
}

export async function typeHarmony(device: DeviceInfo, text: string): Promise<void> {
  await runHarmonyHdc(device, ['shell', 'uitest', 'uiInput', 'text', text]);
}

export async function fillHarmony(
  device: DeviceInfo,
  point: Point,
  text: string,
  delayMs: number = 100,
): Promise<void> {
  const attempts = [
    { clearCount: 20, chunkSize: 50 },
    { clearCount: 40, chunkSize: 25 },
  ] as const;

  for (let attemptIdx = 0; attemptIdx < attempts.length; attemptIdx++) {
    const attempt = attempts[attemptIdx]!;
    const clearCount = attempt.clearCount;
    const chunkSize = attempt.chunkSize;

    // Focus the target
    await pressHarmony(device, point.x, point.y);
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    // Clear existing text
    await clearFocusedTextHarmony(device, clearCount);

    // Type in chunks if needed
    if (text.length <= chunkSize) {
      await typeHarmony(device, text);
    } else {
      for (let offset = 0; offset < text.length; offset += chunkSize) {
        await typeHarmony(device, text.slice(offset, offset + chunkSize));
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    }

    // Verify
    const verification = await verifyHarmonyFilledText(device, point, text);
    if (verification.ok) return;

    if (attemptIdx === attempts.length - 1) {
      throw new AppError('COMMAND_FAILED', `Fill verification failed on HarmonyOS. Expected "${text}", got "${verification.actualText}".`, {
        failureReason: 'fill_verification',
        expectedText: text,
        actualText: verification.actualText,
      });
    }
  }
}

async function clearFocusedTextHarmony(device: DeviceInfo, count: number): Promise<void> {
  // Select all then delete
  await runHarmonyHdc(device, ['shell', 'uitest', 'uiInput', 'keyEvent', 'Ctrl+A'], {
    allowFailure: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  // Send delete keys to clear selected text
  for (let i = 0; i < Math.ceil(count / 10); i++) {
    await runHarmonyHdc(
      device,
      ['shell', 'uitest', 'uiInput', 'keyEvent', 'Delete'],
      { allowFailure: true },
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function verifyHarmonyFilledText(
  device: DeviceInfo,
  point: Point,
  expectedText: string,
): Promise<{ ok: boolean; actualText: string }> {
  const delays = [0, 150, 300];
  for (const delay of delays) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    const actualText = await readHarmonyTextAtPoint(device, point.x, point.y);
    if (actualText === expectedText) {
      return { ok: true, actualText };
    }
    // Whitespace-normalized comparison
    const normalizedActual = actualText.replace(/\s+/g, ' ').trim();
    const normalizedExpected = expectedText.replace(/\s+/g, ' ').trim();
    if (normalizedActual === normalizedExpected) {
      return { ok: true, actualText };
    }
  }
  const actualText = await readHarmonyTextAtPoint(device, point.x, point.y);
  return { ok: false, actualText };
}

export async function scrollHarmony(
  device: DeviceInfo,
  direction: ScrollDirection,
  options?: { amount?: number; pixels?: number },
): Promise<Record<string, unknown>> {
  const size = await getHarmonyScreenSize(device);
  const plan = buildScrollGesturePlan({
    direction,
    amount: options?.amount,
    pixels: options?.pixels,
    referenceWidth: size.width,
    referenceHeight: size.height,
  });

  await swipeHarmony(device, { x: plan.x1, y: plan.y1 }, { x: plan.x2, y: plan.y2 }, 300);
  return plan;
}

export async function getHarmonyScreenSize(
  device: DeviceInfo,
): Promise<{ width: number; height: number }> {
  // Method 1: Try to get display resolution via param get
  const paramResult = await runHarmonyHdc(
    device,
    ['shell', 'param', 'get', 'const.display.resolution'],
    { allowFailure: true, timeoutMs: 10_000 },
  );

  if (paramResult.exitCode === 0 && paramResult.stdout.trim()) {
    const match = paramResult.stdout.match(/(\d+)\s*[x*]\s*(\d+)/);
    if (match) {
      return { width: Number(match[1]), height: Number(match[2]) };
    }
  }

  // Method 2: Try getWindowInfo for screen dimensions
  const windowResult = await runHarmonyHdc(
    device,
    ['shell', 'uitest', 'getWindowInfo'],
    { allowFailure: true, timeoutMs: 10_000 },
  );

  if (windowResult.exitCode === 0 && windowResult.stdout.trim()) {
    try {
      const info = JSON.parse(windowResult.stdout);
      if (info.width && info.height) {
        return { width: info.width, height: info.height };
      }
      // Some versions may have windowRect
      if (info.windowRect) {
        const rect = info.windowRect;
        return { width: rect.right - rect.left, height: rect.bottom - rect.top };
      }
    } catch {
      // JSON parse failed, continue to next method
    }
  }

  // Method 3: Parse from snapshot dumpLayout root bounds
  const { snapshotHarmony } = await import('./snapshot.ts');
  const snapshot = await snapshotHarmony(device, { raw: true, maxNodes: 1 });

  // Find the root node with the largest bounds (typically full screen)
  let maxWidth = 0;
  let maxHeight = 0;
  for (const node of snapshot.nodes ?? []) {
    const rect = node.rect;
    if (rect && rect.width > maxWidth && rect.height > maxHeight) {
      maxWidth = rect.width;
      maxHeight = rect.height;
    }
  }

  if (maxWidth > 0 && maxHeight > 0) {
    return { width: maxWidth, height: maxHeight };
  }

  throw new AppError(
    'COMMAND_FAILED',
    'Unable to read HarmonyOS screen size. Please ensure device is connected and accessible.',
  );
}

export async function pressBackHarmony(device: DeviceInfo): Promise<void> {
  await runHarmonyHdc(device, ['shell', 'uitest', 'uiInput', 'keyEvent', 'Back']);
}

export async function pressHomeHarmony(device: DeviceInfo): Promise<void> {
  await runHarmonyHdc(device, ['shell', 'uitest', 'uiInput', 'keyEvent', 'Home']);
}

export async function pressKeyHarmony(device: DeviceInfo, key: string): Promise<void> {
  await runHarmonyHdc(device, ['shell', 'uitest', 'uiInput', 'keyEvent', key]);
}

export async function focusHarmony(device: DeviceInfo, x: number, y: number): Promise<void> {
  await pressHarmony(device, x, y);
}

export async function readHarmonyTextAtPoint(
  device: DeviceInfo,
  x: number,
  y: number,
): Promise<string> {
  const { snapshotHarmony } = await import('./snapshot.ts');
  const result = await snapshotHarmony(device, { raw: true, maxNodes: 500 });

  let bestMatch: { text: string; area: number } | null = null;

  for (const node of result.nodes) {
    const rect = node.rect;
    if (!rect) continue;
    if (!pointInRect(x, y, rect)) continue;

    const text = node.value ?? '';
    if (!text) continue;

    const area = rect.width * rect.height;
    // Prefer focused nodes, then smallest containing node with text
    if (!bestMatch || (node.focused && !bestMatch) || area < bestMatch.area) {
      bestMatch = { text, area };
    }
  }

  return bestMatch?.text ?? '';
}

function pointInRect(px: number, py: number, rect: Rect): boolean {
  return px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height;
}
