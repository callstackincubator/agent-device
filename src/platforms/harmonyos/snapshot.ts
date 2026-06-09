import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { attachRefs, type SnapshotNode, type SnapshotOptions } from '../../utils/snapshot.ts';
import { runHarmonyHdc } from './hdc.ts';
import {
  parseArkUiTree,
  buildArkUiSnapshot,
  type ArkUiHierarchyResult,
} from './arkui-hierarchy.ts';
import { ensureHarmonyUitestReady } from './uitest-preflight.ts';

const DEFAULT_MAX_NODES = 5000;

export type HarmonySnapshotResult = ArkUiHierarchyResult & {
  nodes: SnapshotNode[];
  backend: 'harmonyos-arkui';
};

export async function snapshotHarmony(
  device: DeviceInfo,
  options: SnapshotOptions & { maxNodes?: number },
): Promise<HarmonySnapshotResult> {
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const uuid = randomUUID();
  const remotePath = `/data/local/tmp/hd-layout-${uuid}.json`;
  const localDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hd-snapshot-'));
  const localPath = path.join(localDir, `layout-${uuid}.json`);

  try {
    await ensureHarmonyUitestReady(device);

    // Step 1: Dump layout on device
    const dumpResult = await runHarmonyHdc(
      device,
      ['shell', 'uitest', 'dumpLayout', '-p', remotePath],
      { allowFailure: false, timeoutMs: 30_000 },
    );

    if (dumpResult.exitCode !== 0) {
      throw new AppError('COMMAND_FAILED', `uitest dumpLayout failed: ${dumpResult.stderr}`);
    }

    // Step 2: Pull file to local
    await runHarmonyHdc(device, ['file', 'recv', remotePath, localPath], {
      allowFailure: false,
      timeoutMs: 15_000,
    });

    // Step 3: Cleanup remote file
    await runHarmonyHdc(device, ['shell', 'rm', '-f', remotePath], {
      allowFailure: true,
    });

    // Step 4: Parse the JSON file
    const jsonContent = await fs.readFile(localPath, 'utf-8');
    const tree = parseArkUiTree(jsonContent);
    const result = buildArkUiSnapshot(tree, maxNodes, options);

    // Step 5: Attach refs (@e1, @e2, etc.)
    const nodesWithRefs = attachRefs(result.nodes);

    return {
      ...result,
      nodes: nodesWithRefs,
      backend: 'harmonyos-arkui',
    };
  } finally {
    await fs.rm(localDir, { recursive: true, force: true });
  }
}
