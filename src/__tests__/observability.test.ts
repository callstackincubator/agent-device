import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  mapNetworkDumpToBackendResult,
  mergeNetworkDumps,
  readRecentNetworkTrafficFromText,
  redactNetworkLogText,
  type NetworkLogBackend,
} from '../observability.ts';

test('public observability parser reads recent network traffic from text', () => {
  const dump = readRecentNetworkTrafficFromText(
    [
      '2026-02-24T10:00:00Z GET https://api.example.com/v1/profile status=200',
      '2026-02-24T10:00:02Z {"method":"POST","url":"https://api.example.com/v1/login","statusCode":401,"headers":{"x-id":"abc"},"requestBody":{"email":"u@example.com"},"responseBody":{"error":"denied"}}',
    ].join('\n'),
    {
      sourcePath: 'limrun://session/app.log',
      backend: 'ios-simulator',
      include: 'all',
      maxEntries: 5,
      maxScanLines: 100,
    },
  );

  assert.equal(dump.sourcePath, 'limrun://session/app.log');
  assert.equal(dump.matchedLines, 2);
  assert.equal(dump.entries[0]?.url, 'https://api.example.com/v1/login');
  assert.equal(dump.entries[0]?.status, 401);
  assert.equal(dump.entries[0]?.headers, '{"x-id":"abc"}');
  assert.equal(dump.entries[0]?.requestBody, '{"email":"u@example.com"}');
  assert.equal(dump.entries[0]?.responseBody, '{"error":"denied"}');
});

test('public observability parser accepts custom backend labels', () => {
  const backend: NetworkLogBackend = 'limrun-ios-device';
  const dump = readRecentNetworkTrafficFromText(
    '2026-02-24T10:00:00Z GET https://api.example.com/v1/profile status=200',
    { backend },
  );

  assert.equal(dump.entries[0]?.url, 'https://api.example.com/v1/profile');
});

test('public observability parser preserves scan metadata at the boundary', () => {
  const dump = readRecentNetworkTrafficFromText(
    [
      '2026-02-24T10:00:00Z GET https://api.example.com/old status=200',
      ...Array.from({ length: 99 }, (_entry, index) => `ignored ${index}`),
      '2026-02-24T10:00:01Z GET https://api.example.com/recent status=200',
    ].join('\n'),
    { maxEntries: 5, maxScanLines: 2 },
  );

  assert.equal(dump.sourcePath, undefined);
  assert.equal(dump.scannedLines, 100);
  assert.equal(dump.matchedLines, 1);
  assert.equal(dump.entries[0]?.url, 'https://api.example.com/recent');
  assert.deepEqual(dump.limits, {
    maxEntries: 5,
    maxPayloadChars: 2048,
    maxScanLines: 100,
  });
});

test('public observability parser preserves Android packet IDs', () => {
  const dump = readRecentNetworkTrafficFromText(
    [
      '03-31 17:43:32.564 V/GIBSDK  (17434): [NetworkAgent]: packet id 23911610 added, queue size: 1',
      '03-31 17:43:33.031 D/GIBSDK  (17434): [NetworkAgent] packet id 23911610 total elapsed request/response time, ms: 377; response code: 200;',
      '03-31 17:43:33.031 D/GIBSDK  (17434): URL: https://www.example.com/api/fl?as=2.0',
    ].join('\n'),
    { backend: 'android', maxEntries: 5, maxScanLines: 100 },
  );

  assert.equal(dump.entries.length, 1);
  assert.equal(dump.entries[0]?.packetId, '23911610');
  assert.equal(dump.entries[0]?.metadata?.packetId, '23911610');
});

test('public observability merge de-duplicates entries and honors max entries', () => {
  const primary = readRecentNetworkTrafficFromText(
    '2026-02-24T10:00:00Z GET https://api.example.com/primary status=200',
  );
  const secondary = readRecentNetworkTrafficFromText(
    [
      '2026-02-24T10:00:00Z GET https://api.example.com/primary status=200',
      '2026-02-24T10:00:01Z GET https://api.example.com/secondary status=200',
    ].join('\n'),
  );

  const merged = mergeNetworkDumps(primary, secondary, 2);
  const empty = mergeNetworkDumps(primary, secondary, 0);

  assert.equal(merged.entries.length, 2);
  assert.equal(merged.entries[0]?.url, 'https://api.example.com/primary');
  assert.equal(merged.entries[1]?.url, 'https://api.example.com/secondary');
  assert.equal(empty.entries.length, 0);
});

test('public observability mapper produces backend diagnostics result', () => {
  const dump = readRecentNetworkTrafficFromText(
    '2026-02-24T10:00:02Z {"method":"POST","url":"https://api.example.com/v1/login","statusCode":401,"headers":{"x-id":"abc"},"requestBody":{"email":"u@example.com"}}',
    { backend: 'ios-simulator', include: 'all' },
  );
  dump.entries[0] = {
    ...dump.entries[0],
    packetId: 'packet-1',
    metadata: { packetId: 'packet-1' },
  };

  const result = mapNetworkDumpToBackendResult(dump, {
    backend: 'limrun',
    redacted: true,
    notes: ['Parsed recent Limrun app log output.'],
  });

  assert.equal(result.backend, 'limrun');
  assert.equal(result.redacted, true);
  assert.deepEqual(result.notes, ['Parsed recent Limrun app log output.']);
  assert.equal(result.entries[0]?.url, 'https://api.example.com/v1/login');
  assert.equal(result.entries[0]?.metadata?.packetId, 'packet-1');
  assert.equal(result.entries[0]?.metadata?.headers, '{"x-id":"abc"}');
  assert.equal('requestHeaders' in (result.entries[0] ?? {}), false);
  assert.equal('raw' in (result.entries[0] ?? {}), false);
  assert.equal('line' in (result.entries[0] ?? {}), false);
});

test('public observability mapper handles empty dumps', () => {
  const dump = readRecentNetworkTrafficFromText('');
  const result = mapNetworkDumpToBackendResult(dump, { backend: 'limrun' });

  assert.equal(result.backend, 'limrun');
  assert.deepEqual(result.entries, []);
});

test('public observability redaction handles network log secrets', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.aVeryLongSignatureValue123456789';
  const line =
    `GET https://user:pass@api.example.com/path?token=secret-token&ok=1 Authorization: Bearer ${jwt} ` +
    'Cookie: session=secret {"apiKey":"abc123"}';

  const redactedLine = redactNetworkLogText(line);
  const redactedText = redactNetworkLogText(`${line}\nnext password=secret`);

  assert.equal(redactedLine.redacted, true);
  assert.match(redactedLine.value, /REDACTED/);
  assert.doesNotMatch(redactedLine.value, /secret-token|abc123|Bearer eyJ|session=secret/);
  assert.equal(redactedText.redacted, true);
  assert.doesNotMatch(redactedText.value, /password=secret/);

  const parsed = readRecentNetworkTrafficFromText(redactedLine.value);
  assert.equal(
    parsed.entries[0]?.url,
    'https://REDACTED:REDACTED@api.example.com/path?token=%5BREDACTED%5D&ok=1',
  );
});
