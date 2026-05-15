import assert from 'node:assert/strict';
import type { Platform } from '../../src/utils/device.ts';

export interface DeviceLabProviderScope {
  deviceId?: string;
  platform?: Platform;
}

export interface DeviceLabProviderEntry<TResult = unknown> extends DeviceLabProviderScope {
  command: string;
  request?: unknown;
  result?: TResult;
  error?: Error | string;
}

export interface DeviceLabProviderCall<TResult = unknown> extends DeviceLabProviderScope {
  command: string;
  request?: unknown;
  result?: TResult;
}

export interface DeviceLabTranscript {
  readonly calls: readonly DeviceLabProviderCall[];
  readonly remaining: readonly DeviceLabProviderEntry[];
  next<TResult = unknown>(
    command: string,
    request?: unknown,
    scope?: DeviceLabProviderScope,
  ): TResult;
  assertComplete(): void;
}

export function createProviderTranscript(
  entries: readonly DeviceLabProviderEntry[],
): DeviceLabTranscript {
  const pending = [...entries];
  const calls: DeviceLabProviderCall[] = [];

  return {
    get calls() {
      return [...calls];
    },
    get remaining() {
      return [...pending];
    },
    next<TResult = unknown>(
      command: string,
      request?: unknown,
      scope: DeviceLabProviderScope = {},
    ): TResult {
      const entry = pending.shift();
      assert.ok(entry, `Unexpected provider call: ${formatCall(command, scope)}`);
      assert.equal(command, entry.command, 'Provider command mismatch');
      assertScope(scope, entry);
      if (Object.hasOwn(entry, 'request')) {
        assert.deepEqual(request, entry.request, 'Provider request mismatch');
      }

      const call = {
        command,
        request,
        deviceId: scope.deviceId,
        platform: scope.platform,
        result: entry.result as TResult,
      };
      calls.push(call);

      if (entry.error) {
        throw entry.error instanceof Error ? entry.error : new Error(entry.error);
      }

      return entry.result as TResult;
    },
    assertComplete() {
      assert.equal(
        pending.length,
        0,
        `Unconsumed provider transcript entries: ${pending.map(formatEntry).join(', ')}`,
      );
    },
  };
}

function assertScope(actual: DeviceLabProviderScope, expected: DeviceLabProviderEntry): void {
  if (expected.deviceId) {
    assert.equal(actual.deviceId, expected.deviceId, 'Provider device id mismatch');
  }
  if (expected.platform) {
    assert.equal(actual.platform, expected.platform, 'Provider platform mismatch');
  }
}

function formatCall(command: string, scope: DeviceLabProviderScope): string {
  return formatEntry({ command, ...scope });
}

function formatEntry(entry: { command: string; deviceId?: string; platform?: Platform }): string {
  const scope = [entry.platform, entry.deviceId].filter(Boolean).join(':');
  return scope ? `${scope}.${entry.command}` : entry.command;
}
