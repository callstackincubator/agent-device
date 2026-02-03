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
  options: { traceLogPath?: string } = {},
): Promise<{ nodes: RawSnapshotNode[] }> {
  if (device.platform !== 'ios' || device.kind !== 'simulator') {
    throw new AppError('UNSUPPORTED_OPERATION', 'AX snapshot is only supported on iOS simulators');
  }
  const binary = await ensureAxSnapshotBinary();
  const result = await runCmd(binary, [], { allowFailure: true });
  if (options.traceLogPath) {
    const stdoutText = (result.stdout ?? '').toString();
    const stderrText = (result.stderr ?? '').toString();
    const header = `\n[axsnapshot] exit=${result.exitCode} stdoutBytes=${stdoutText.length} stderrBytes=${stderrText.length}\n`;
    fs.appendFileSync(options.traceLogPath, header);
    if (result.exitCode !== 0 || stderrText.length > 0) {
      if (stderrText.length > 0) {
        fs.appendFileSync(options.traceLogPath, `${stderrText}\n`);
      }
      if (result.exitCode !== 0 && stdoutText.length > 0) {
        fs.appendFileSync(options.traceLogPath, `${stdoutText}\n`);
      }
    }
  }
  if (result.exitCode !== 0) {
    const stderrText = (result.stderr ?? '').toString();
    let hint = '';
    if (stderrText.toLowerCase().includes('accessibility permission')) {
      hint =
        ' Enable Accessibility for your terminal in System Settings > Privacy & Security > Accessibility, ' +
        'or use --backend xctest (slower snapshots via XCTest).';
    }
    if (stderrText.toLowerCase().includes('could not find ios app content')) {
      hint =
        ' AX snapshot sometimes caches empty content. Try restarting the Simulator app.';
    }
    throw new AppError('COMMAND_FAILED', 'AX snapshot failed', {
      stderr: `${stderrText}${hint}`,
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
  return { nodes: mapped };
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
  const envPath = process.env.AGENT_DEVICE_AX_BINARY;
  if (envPath && fs.existsSync(envPath)) return envPath;
  const packagedPath = path.join(projectRoot, 'dist', 'bin', 'axsnapshot');
  if (fs.existsSync(packagedPath)) return packagedPath;
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
