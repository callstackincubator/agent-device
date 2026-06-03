#!/usr/bin/env node
/**
 * Preflight for HarmonyOS traverse/snapshot: detect stuck uitest uiRecord.
 * Exit 1 with reboot instructions when uitest broadcast is blocked.
 */
import { spawnSync } from 'child_process';

const device = (process.env.TRAVERSE_DEVICE || process.env.TRAVERSE_HDC_TARGET || '').trim();
if (!device) {
  console.error('Set TRAVERSE_DEVICE or TRAVERSE_HDC_TARGET to the hdc serial.');
  process.exit(1);
}

const ps = spawnSync('hdc', ['-t', device, 'shell', 'ps', '-ef'], { encoding: 'utf8' });
const lines = (ps.stdout || '').split('\n');
const stuck = lines.find((line) => /uitest\s+uiRecord\s+record/i.test(line));
if (stuck) {
  console.error('HarmonyOS uitest 被卡住的 uiRecord 占用，dumpLayout/snapshot 会超时。');
  console.error(`进程: ${stuck.trim()}`);
  console.error('处理: 重启鸿蒙设备，然后重新跑遍历。');
  console.error('原因: 之前误跑的 `hdc shell uitest uiRecord record` 会独占 uitest 广播通道。');
  process.exit(1);
}

spawnSync('hdc', ['-t', device, 'shell', 'uitest', 'start-daemon', 'agent-device'], {
  encoding: 'utf8',
});
console.log('uitest preflight ok');
