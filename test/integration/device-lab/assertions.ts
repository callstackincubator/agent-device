import assert from 'node:assert/strict';
import fs from 'node:fs';

export function assertCommandCall(calls: readonly string[][], expected: readonly string[]): void {
  assert.ok(
    calls.some((call) => arrayEqual(call, expected)),
    `Expected command call ${JSON.stringify(expected)} in ${JSON.stringify(calls)}`,
  );
}

export function assertToolCall(
  calls: Array<[string, string[]]>,
  expected: [string, ...string[]],
): void {
  assert.ok(
    calls.some(([cmd, args]) => arrayEqual([cmd, ...args], expected)),
    `Expected tool call ${JSON.stringify(expected)} in ${JSON.stringify(calls)}`,
  );
}

export function assertFlatToolCall(
  calls: Array<[string, ...string[]]>,
  expected: [string, ...string[]],
): void {
  assert.ok(
    calls.some((call) => arrayEqual(call, expected)),
    `Expected tool call ${JSON.stringify(expected)} in ${JSON.stringify(calls)}`,
  );
}

export function assertToolCallStartsWith(
  calls: Array<[string, string[]]>,
  expected: [string, ...string[]],
): void {
  assert.ok(
    calls.some(([cmd, args]) => arrayStartsWith([cmd, ...args], expected)),
    `Expected tool call starting with ${JSON.stringify(expected)} in ${JSON.stringify(calls)}`,
  );
}

export function assertFlatToolCallStartsWith(
  calls: Array<[string, ...string[]]>,
  expected: [string, ...string[]],
): void {
  assert.ok(
    calls.some((call) => arrayStartsWith(call, expected)),
    `Expected tool call starting with ${JSON.stringify(expected)} in ${JSON.stringify(calls)}`,
  );
}

export function arrayEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function arrayStartsWith(left: readonly string[], right: readonly string[]): boolean {
  return right.every((value, index) => left[index] === value);
}

export function validPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+b9xkAAAAASUVORK5CYII=',
    'base64',
  );
}

export function pngSignature(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

export function assertPngFile(filePath: string): void {
  assert.deepEqual(fs.readFileSync(filePath).subarray(0, 8), pngSignature());
}
