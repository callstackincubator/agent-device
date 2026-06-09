import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { parseHarmonyDeviceList } from '../devices.ts';

describe('HarmonyOS Device Discovery', () => {
  describe('parseHarmonyDeviceList', () => {
    it('parses empty output correctly', () => {
      const result = parseHarmonyDeviceList('');
      assert.deepEqual(result, []);
    });

    it('parses single device', () => {
      const output = '192.168.1.100:5555\n';
      const result = parseHarmonyDeviceList(output);
      assert.deepEqual(result, ['192.168.1.100:5555']);
    });

    it('parses multiple devices', () => {
      const output = 'device1\ndevice2\ndevice3\n';
      const result = parseHarmonyDeviceList(output);
      assert.deepEqual(result, ['device1', 'device2', 'device3']);
    });

    it('filters out [Empty] marker', () => {
      const output = '[Empty]\n';
      const result = parseHarmonyDeviceList(output);
      assert.deepEqual(result, []);
    });

    it('handles whitespace correctly', () => {
      const output = '  device1  \n  device2  \n\n  \n';
      const result = parseHarmonyDeviceList(output);
      assert.deepEqual(result, ['device1', 'device2']);
    });
  });
});
