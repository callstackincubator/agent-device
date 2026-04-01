import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../../utils/exec.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/exec.ts')>();
  return { ...actual, runCmd: vi.fn() };
});
vi.mock('../adb.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../adb.ts')>();
  return { ...actual, sleep: vi.fn() };
});

import { screenshotAndroid } from '../screenshot.ts';
import { dumpUiHierarchy, snapshotAndroid } from '../snapshot.ts';
import { buildUiHierarchySnapshot, parseUiHierarchyTree } from '../ui-hierarchy.ts';
import type { DeviceInfo } from '../../../utils/device.ts';
import { AppError } from '../../../utils/errors.ts';
import { runCmd } from '../../../utils/exec.ts';
import { sleep } from '../adb.ts';

const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+b9xkAAAAASUVORK5CYII=',
  'base64',
);
const mockRunCmd = vi.mocked(runCmd);
const mockSleep = vi.mocked(sleep);

const device: DeviceInfo = {
  platform: 'android',
  id: 'emulator-5554',
  name: 'Pixel',
  kind: 'emulator',
  booted: true,
};

beforeEach(() => {
  mockRunCmd.mockReset();
  mockSleep.mockReset();
  mockSleep.mockResolvedValue(undefined);
  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('exec-out')) {
      return { exitCode: 0, stdout: '', stderr: '', stdoutBuffer: VALID_PNG };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  });
});

test('screenshotAndroid waits for transient UI to settle before capture', async () => {
  const events: string[] = [];
  const outPath = path.join(os.tmpdir(), `agent-device-android-screenshot-${Date.now()}.png`);

  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('exec-out')) {
      events.push('capture');
      return { exitCode: 0, stdout: '', stderr: '', stdoutBuffer: VALID_PNG };
    }
    events.push(args.some((arg) => arg.includes('exit')) ? 'disable' : 'enable');
    return { exitCode: 0, stdout: '', stderr: '' };
  });
  mockSleep.mockImplementation(async (ms) => {
    events.push(`settle:${ms}`);
  });

  await screenshotAndroid(device, outPath);

  const relevantEvents = events.filter((event, index) => {
    if (event !== 'enable') {
      return true;
    }
    return index === 0;
  });
  assert.deepEqual(relevantEvents, ['enable', 'settle:1000', 'capture', 'disable']);
});

test('screenshotAndroid writes a valid PNG when output is clean', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-clean-'));
  try {
    const outPath = path.join(tmpDir, 'out.png');
    await screenshotAndroid(device, outPath);
    const written = await fs.readFile(outPath);
    assert.deepEqual(written, VALID_PNG);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('screenshotAndroid strips warning text before PNG signature', async () => {
  const warning =
    '[Warning] Multiple displays were found, but no display id was specified! Defaulting to the first display found.';
  const payload = Buffer.concat([Buffer.from(warning), VALID_PNG]);
  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('exec-out')) {
      return { exitCode: 0, stdout: '', stderr: '', stdoutBuffer: payload };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-warning-'));
  try {
    const outPath = path.join(tmpDir, 'out.png');
    await screenshotAndroid(device, outPath);
    const written = await fs.readFile(outPath);
    assert.deepEqual(written, VALID_PNG);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('screenshotAndroid strips trailing garbage after PNG payload', async () => {
  const payload = Buffer.concat([VALID_PNG, Buffer.from('\ntrailing-warning\n')]);
  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('exec-out')) {
      return { exitCode: 0, stdout: '', stderr: '', stdoutBuffer: payload };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-trailing-'));
  try {
    const outPath = path.join(tmpDir, 'out.png');
    await screenshotAndroid(device, outPath);
    const written = await fs.readFile(outPath);
    assert.deepEqual(written, VALID_PNG);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('screenshotAndroid throws when output contains no PNG signature', async () => {
  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('exec-out')) {
      return { exitCode: 0, stdout: '', stderr: '', stdoutBuffer: Buffer.from('not a png') };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-nopng-'));
  try {
    const outPath = path.join(tmpDir, 'out.png');
    await assert.rejects(() => screenshotAndroid(device, outPath), {
      message: 'Screenshot data does not contain a valid PNG header',
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('screenshotAndroid throws when PNG payload is truncated', async () => {
  const payload = VALID_PNG.subarray(0, VALID_PNG.length - 3);
  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('exec-out')) {
      return { exitCode: 0, stdout: '', stderr: '', stdoutBuffer: payload };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshot-truncated-'));
  try {
    const outPath = path.join(tmpDir, 'out.png');
    await assert.rejects(() => screenshotAndroid(device, outPath), {
      message: 'Screenshot data does not contain a complete PNG payload',
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('dumpUiHierarchy returns streamed XML even when exec-out exits non-zero', async () => {
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?><hierarchy><node text="streamed"/></hierarchy>';

  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('exec-out')) {
      return { exitCode: 1, stdout: xml, stderr: 'theme warning' };
    }
    throw new Error('fallback should not run');
  });

  const result = await dumpUiHierarchy(device);

  assert.equal(result, xml);
  assert.equal(mockRunCmd.mock.calls.length, 1);
});

test('dumpUiHierarchy reads fallback XML when dump exits non-zero', async () => {
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?><hierarchy><node text="fallback"/></hierarchy>';

  mockRunCmd.mockImplementation(async (_cmd, args, options) => {
    if (args.includes('exec-out')) {
      return { exitCode: 1, stdout: '', stderr: 'stream unavailable' };
    }
    if (
      args.includes('uiautomator') &&
      args.includes('dump') &&
      args.includes('/sdcard/window_dump.xml')
    ) {
      if (options?.allowFailure !== true) {
        throw new AppError('COMMAND_FAILED', 'adb exited with code 1', {
          stderr: 'theme engine error',
        });
      }
      return {
        exitCode: 1,
        stdout: 'UI hierarchy dumped to: /sdcard/window_dump.xml',
        stderr: 'theme engine error',
      };
    }
    if (args.includes('cat') && args.includes('/sdcard/window_dump.xml')) {
      return { exitCode: 0, stdout: xml, stderr: '' };
    }
    throw new Error(`unexpected args: ${args.join(' ')}`);
  });

  const result = await dumpUiHierarchy(device);
  const dumpCall = mockRunCmd.mock.calls.find(([, args]) =>
    args.includes('/sdcard/window_dump.xml'),
  );
  const catCall = mockRunCmd.mock.calls.find(
    ([, args]) => args.includes('cat') && args.includes('/sdcard/window_dump.xml'),
  );

  assert.equal(result, xml);
  assert.deepEqual(dumpCall?.[2], { allowFailure: true });
  assert.equal(catCall?.[2], undefined);
});

test('dumpUiHierarchy retries when fallback dump file is temporarily missing', async () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><hierarchy><node text="retried"/></hierarchy>';
  let catAttempts = 0;

  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('exec-out')) {
      return { exitCode: 1, stdout: '', stderr: 'stream unavailable' };
    }
    if (
      args.includes('uiautomator') &&
      args.includes('dump') &&
      args.includes('/sdcard/window_dump.xml')
    ) {
      return {
        exitCode: 0,
        stdout: 'UI hierarchy dumped to: /sdcard/window_dump.xml',
        stderr: '',
      };
    }
    if (args.includes('cat') && args.includes('/sdcard/window_dump.xml')) {
      catAttempts += 1;
      if (catAttempts === 1) {
        throw new AppError('COMMAND_FAILED', 'adb exited with code 1', {
          stderr: 'cat: /sdcard/window_dump.xml: No such file or directory',
        });
      }
      return { exitCode: 0, stdout: xml, stderr: '' };
    }
    throw new Error(`unexpected args: ${args.join(' ')}`);
  });

  const result = await dumpUiHierarchy(device);

  assert.equal(result, xml);
  assert.equal(catAttempts, 2);
  assert.equal(
    mockRunCmd.mock.calls.filter(
      ([, args]) => args.includes('uiautomator') && args.includes('/sdcard/window_dump.xml'),
    ).length,
    2,
  );
});

test('snapshotAndroid preserves hidden scroll content hints in interactive snapshots', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node class="android.widget.FrameLayout" bounds="[0,0][390,844]" clickable="false" focusable="false">
    <node class="android.widget.ScrollView" content-desc="Messages" bounds="[0,100][390,600]" clickable="false" focusable="false">
      <node class="android.view.ViewGroup" bounds="[0,100][390,600]" clickable="false" focusable="false">
        <node class="android.widget.Button" text="Earlier message" bounds="[0,100][390,268]" clickable="true" focusable="true" />
        <node class="android.widget.Button" text="Visible message" bounds="[0,268][390,436]" clickable="true" focusable="true" />
        <node class="android.widget.Button" text="Later message" bounds="[0,436][390,604]" clickable="true" focusable="true" />
      </node>
    </node>
  </node>
</hierarchy>`;
  const dump = [
    '    com.facebook.react.views.scroll.ReactScrollView{d32a800 VFED.V... ........ 0,0-390,500 #4b2}',
    '      com.facebook.react.views.view.ReactViewGroup{77d31ae V.E...... ........ 0,0-390,1000 #4b0}',
    '        com.facebook.react.views.view.ReactViewGroup{a V.E...... ........ 0,300-390,468 #1}',
    '        com.facebook.react.views.view.ReactViewGroup{b V.E...... ........ 0,468-390,636 #2}',
    '        com.facebook.react.views.view.ReactViewGroup{c V.E...... ........ 0,636-390,804 #3}',
  ].join('\n');

  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('exec-out')) {
      return { exitCode: 0, stdout: xml, stderr: '' };
    }
    if (args.includes('dumpsys') && args.includes('activity') && args.includes('top')) {
      return { exitCode: 0, stdout: dump, stderr: '' };
    }
    throw new Error(`unexpected args: ${args.join(' ')}`);
  });

  const result = await snapshotAndroid(device, { interactiveOnly: true });
  const scrollArea = result.nodes.find((node) => node.type === 'android.widget.ScrollView');

  assert.ok(scrollArea);
  assert.equal(scrollArea?.hiddenContentAbove, true);
  assert.equal(scrollArea?.hiddenContentBelow, true);
});

test('snapshotAndroid keeps generic-id scroll containers in interactive snapshots', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node class="android.widget.FrameLayout" bounds="[0,0][390,844]" clickable="false" focusable="false">
    <node class="android.widget.ScrollView" resource-id="com.android.settings:id/main_content_scrollable_container" bounds="[0,100][390,600]" clickable="false" focusable="false">
      <node class="android.view.ViewGroup" bounds="[0,100][390,600]" clickable="false" focusable="false">
        <node class="android.widget.TextView" text="Network &amp; internet" bounds="[20,140][240,180]" clickable="false" focusable="false" />
        <node class="android.widget.Button" text="Apps" bounds="[20,240][200,288]" clickable="true" focusable="true" />
      </node>
    </node>
  </node>
</hierarchy>`;

  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('exec-out')) {
      return { exitCode: 0, stdout: xml, stderr: '' };
    }
    if (args.includes('dumpsys') && args.includes('activity') && args.includes('top')) {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    throw new Error(`unexpected args: ${args.join(' ')}`);
  });

  const result = await snapshotAndroid(device, { interactiveOnly: true });
  const scrollArea = result.nodes.find(
    (node) =>
      node.type === 'android.widget.ScrollView' &&
      node.identifier === 'com.android.settings:id/main_content_scrollable_container',
  );

  assert.ok(scrollArea);
});

test('snapshotAndroid skips activity dump when snapshot has no scrollable nodes', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node class="android.widget.FrameLayout" bounds="[0,0][390,844]" clickable="false" focusable="false">
    <node class="android.widget.Button" text="Continue" bounds="[20,120][200,180]" clickable="true" focusable="true" />
  </node>
</hierarchy>`;

  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('exec-out')) {
      return { exitCode: 0, stdout: xml, stderr: '' };
    }
    if (args.includes('dumpsys') && args.includes('activity') && args.includes('top')) {
      throw new Error('dumpsys activity top should not run without scrollable nodes');
    }
    throw new Error(`unexpected args: ${args.join(' ')}`);
  });

  const result = await snapshotAndroid(device, { interactiveOnly: true });

  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0]?.label, 'Continue');
});

test('snapshotAndroid derives hidden content hints for interactive snapshots from shared visibility semantics', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node class="android.widget.FrameLayout" bounds="[0,0][390,844]" clickable="false" focusable="false">
    <node class="android.widget.ScrollView" content-desc="Messages" bounds="[0,100][390,500]" clickable="false" focusable="false">
      <node class="android.view.ViewGroup" bounds="[0,100][390,500]" clickable="false" focusable="false">
        <node class="android.widget.Button" text="Visible message" bounds="[0,120][390,180]" clickable="true" focusable="true" />
        <node class="android.widget.TextView" text="Offscreen message" bounds="[0,560][390,620]" clickable="false" focusable="false" />
      </node>
    </node>
  </node>
</hierarchy>`;

  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('exec-out')) {
      return { exitCode: 0, stdout: xml, stderr: '' };
    }
    if (args.includes('dumpsys') && args.includes('activity') && args.includes('top')) {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    throw new Error(`unexpected args: ${args.join(' ')}`);
  });

  const result = await snapshotAndroid(device, { interactiveOnly: true });
  const scrollArea = result.nodes.find((node) => node.type === 'android.widget.ScrollView');

  assert.ok(scrollArea);
  assert.equal(scrollArea?.hiddenContentAbove, undefined);
  assert.equal(scrollArea?.hiddenContentBelow, true);
});

test('snapshotAndroid preserves bottomed-out hidden-above hints in interactive snapshots from a single aligned block', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node class="android.widget.FrameLayout" bounds="[0,0][390,844]" clickable="false" focusable="false">
    <node class="android.widget.ScrollView" content-desc="Messages" bounds="[0,100][390,600]" clickable="false" focusable="false">
      <node class="android.view.ViewGroup" bounds="[0,100][390,600]" clickable="false" focusable="false">
        <node class="android.widget.Button" text="Last message" bounds="[0,432][390,600]" clickable="true" focusable="true" />
      </node>
    </node>
  </node>
</hierarchy>`;
  const dump = [
    '    com.facebook.react.views.scroll.ReactScrollView{d32a800 VFED.V... ........ 0,0-390,500 #4b2}',
    '      com.facebook.react.views.view.ReactViewGroup{77d31ae V.E...... ........ 0,0-390,804 #4b0}',
    '        com.facebook.react.views.view.ReactViewGroup{c V.E...... ........ 0,636-390,804 #3}',
  ].join('\n');

  mockRunCmd.mockImplementation(async (_cmd, args) => {
    if (args.includes('exec-out')) {
      return { exitCode: 0, stdout: xml, stderr: '' };
    }
    if (args.includes('dumpsys') && args.includes('activity') && args.includes('top')) {
      return { exitCode: 0, stdout: dump, stderr: '' };
    }
    throw new Error(`unexpected args: ${args.join(' ')}`);
  });

  const result = await snapshotAndroid(device, { interactiveOnly: true });
  const scrollArea = result.nodes.find(
    (node) => node.hiddenContentAbove === true || node.hiddenContentBelow === true,
  );

  assert.ok(scrollArea);
  assert.equal(scrollArea?.hiddenContentAbove, true);
  assert.equal(scrollArea?.hiddenContentBelow, undefined);
});

test('buildUiHierarchySnapshot preserves hidden content hints from Android tree nodes', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node class="android.widget.FrameLayout" bounds="[0,0][390,844]" clickable="false" focusable="false">
    <node class="android.widget.ScrollView" content-desc="Messages" bounds="[0,100][390,500]" clickable="false" focusable="false">
      <node class="android.view.ViewGroup" bounds="[0,100][390,500]" clickable="false" focusable="false">
        <node class="android.widget.Button" text="Visible message" bounds="[0,120][390,180]" clickable="true" focusable="true" />
      </node>
    </node>
  </node>
</hierarchy>`;

  const tree = parseUiHierarchyTree(xml);
  const scrollNode = tree.children[0]?.children[0];
  assert.ok(scrollNode);
  scrollNode.hiddenContentAbove = true;
  scrollNode.hiddenContentBelow = true;

  const result = buildUiHierarchySnapshot(tree, 800, { interactiveOnly: true });
  const scrollArea = result.nodes.find((node) => node.label === 'Messages');

  assert.ok(scrollArea);
  assert.equal(result.sourceNodes[result.nodes.indexOf(scrollArea)], scrollNode);
  assert.equal(scrollArea.hiddenContentAbove, true);
  assert.equal(scrollArea.hiddenContentBelow, true);
});
