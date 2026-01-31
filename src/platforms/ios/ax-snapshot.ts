import path from 'node:path';
import fs from 'node:fs';
import { AppError } from '../../utils/errors.ts';
import { runCmd } from '../../utils/exec.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import type { RawSnapshotNode } from '../../utils/snapshot.ts';

type AXFrame = { x: number; y: number; width: number; height: number };
type AXNode = {
  role?: string;
  subrole?: string;
  label?: string;
  value?: string;
  identifier?: string;
  frame?: AXFrame;
  children?: AXNode[];
};

export async function snapshotAx(
  device: DeviceInfo,
): Promise<{ nodes: RawSnapshotNode[]; rootRect?: AXFrame }> {
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
  let originFrame: AXFrame | undefined;
  try {
    const payload = JSON.parse(result.stdout) as
      | AXNode
      | { root?: AXNode; windowFrame?: AXFrame | null };
    if (payload && typeof payload === 'object' && 'root' in payload) {
      const snapshot = payload as { root?: AXNode; windowFrame?: AXFrame | null };
      if (!snapshot.root) throw new Error('AX snapshot missing root');
      tree = snapshot.root;
      originFrame = snapshot.windowFrame ?? undefined;
    } else {
      tree = payload as AXNode;
    }
  } catch (err) {
    throw new AppError('COMMAND_FAILED', 'Invalid AX snapshot JSON', { error: String(err) });
  }
  const rootFrame = tree.frame ?? originFrame;
  const frameSamples: AXFrame[] = [];
  const nodes: Array<AXNode & { depth: number }> = [];
  const walk = (node: AXNode, depth: number) => {
    if (node.frame) frameSamples.push(node.frame);
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
  const normalized = normalizeFrames(nodes, rootFrame, frameSamples);
  const mapped = normalized.map((node, index) => ({
    index,
    type: node.subrole ?? node.role,
    label: node.label,
    value: node.value,
    identifier: node.identifier,
    rect: node.frame
      ? {
          x: node.frame.x,
          y: node.frame.y,
          width: node.frame.width,
          height: node.frame.height,
        }
      : undefined,
    depth: node.depth,
  }));
  return { nodes: mapped, rootRect: rootFrame };
}

function normalizeFrames(
  nodes: Array<AXNode & { depth: number }>,
  originFrame: AXFrame | undefined,
  frames: AXFrame[],
): Array<AXNode & { depth: number }> {
  if (!originFrame || frames.length === 0) return nodes;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const frame of frames) {
    if (frame.x < minX) minX = frame.x;
    if (frame.y < minY) minY = frame.y;
  }
  const nearZero = minX <= 5 && minY <= 5;
  if (nearZero) {
    return nodes.map((node) => ({
      ...node,
      frame: node.frame
        ? {
            x: node.frame.x + originFrame.x,
            y: node.frame.y + originFrame.y,
            width: node.frame.width,
            height: node.frame.height,
          }
        : undefined,
    }));
  }
  return nodes;
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
