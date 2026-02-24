import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readRecentNetworkTraffic } from '../network-log.ts';

test('readRecentNetworkTraffic parses latest HTTP entries from session log', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-network-log-'));
  const logPath = path.join(tempDir, 'app.log');
  fs.writeFileSync(
    logPath,
    [
      '2026-02-24T10:00:00Z GET https://api.example.com/v1/profile status=200',
      '2026-02-24T10:00:02Z {"method":"POST","url":"https://api.example.com/v1/login","statusCode":401,"headers":{"x-id":"abc"},"requestBody":{"email":"u@example.com"},"responseBody":{"error":"denied"}}',
      'non-network-line',
    ].join('\n'),
    'utf8',
  );

  const dump = readRecentNetworkTraffic(logPath, {
    maxEntries: 5,
    include: 'all',
    maxPayloadChars: 2048,
    maxScanLines: 100,
  });

  assert.equal(dump.exists, true);
  assert.equal(dump.entries.length, 2);
  assert.equal(dump.entries[0]?.method, 'POST');
  assert.equal(dump.entries[0]?.url, 'https://api.example.com/v1/login');
  assert.equal(dump.entries[0]?.status, 401);
  assert.equal(typeof dump.entries[0]?.headers, 'string');
  assert.equal(typeof dump.entries[0]?.requestBody, 'string');
  assert.equal(typeof dump.entries[0]?.responseBody, 'string');
  assert.equal(dump.entries[1]?.method, 'GET');
  assert.equal(dump.entries[1]?.status, 200);
});

test('readRecentNetworkTraffic returns empty result when log file is missing', () => {
  const logPath = path.join(os.tmpdir(), 'agent-device-network-log-missing', 'app.log');
  const dump = readRecentNetworkTraffic(logPath, { maxEntries: 10, include: 'summary' });
  assert.equal(dump.exists, false);
  assert.equal(dump.entries.length, 0);
});
