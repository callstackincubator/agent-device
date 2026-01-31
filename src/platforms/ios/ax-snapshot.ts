import path from 'node:path';
import fs from 'node:fs';
import { AppError } from '../../utils/errors.ts';
import { runCmd } from '../../utils/exec.ts';
import type { DeviceInfo } from '../../utils/device.ts';

type AXFrame = { x: number; y: number; width: number; height: number };
type AXNode = {
  role?: string;
  label?: string;
  value?: string;
  identifier?: string;
  frame?: AXFrame;
  children?: AXNode[];
};

export async function snapshotAx(device: DeviceInfo): Promise<{ nodes: AXNode[] }> {
  if (device.platform !== 'ios' || device.kind !== 'simulator') {
    throw new AppError('UNSUPPORTED_OPERATION', 'AX snapshot is only supported on iOS simulators');
  }
  const binary = await ensureAxSnapshotBinary();
  const result = await runCmd(binary, [], { allowFailure: true });
  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', 'AX snapshot failed', {
      stderr: result.stderr,
      stdout: result.stdout,
    });
  }
  let tree: AXNode;
  try {
    tree = JSON.parse(result.stdout) as AXNode;
  } catch (err) {
    throw new AppError('COMMAND_FAILED', 'Invalid AX snapshot JSON', { error: String(err) });
  }
  const rootFrame = tree.frame;
  const nodes: Array<AXNode & { depth: number }> = [];
  const walk = (node: AXNode, depth: number) => {
    const frame = node.frame && rootFrame
      ? {
          x: node.frame.x - rootFrame.x,
          y: node.frame.y - rootFrame.y,
          width: node.frame.width,
          height: node.frame.height,
        }
      : node.frame;
    nodes.push({ ...node, frame, children: undefined, depth });
    for (const child of node.children ?? []) {
      walk(child, depth + 1);
    }
  };
  walk(tree, 0);
  return { nodes };
}

async function ensureAxSnapshotBinary(): Promise<string> {
  const projectRoot = findProjectRoot();
  const packageDir = path.join(projectRoot, 'ios-runner', 'AXSnapshot');
  const binaryPath = path.join(packageDir, '.build', 'release', 'axsnapshot');
  if (fs.existsSync(binaryPath)) return binaryPath;
  const result = await runCmd('swift', ['build', '-c', 'release'], {
    cwd: packageDir,
    allowFailure: true,
  });
  if (result.exitCode !== 0 || !fs.existsSync(binaryPath)) {
    throw new AppError('COMMAND_FAILED', 'Failed to build AX snapshot tool', {
      stderr: result.stderr,
      stdout: result.stdout,
    });
  }
  return binaryPath;
}

function findProjectRoot(): string {
  let current = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const pkgPath = path.join(current, 'package.json');
    if (fs.existsSync(pkgPath)) return current;
    current = path.dirname(current);
  }
  return process.cwd();
}
