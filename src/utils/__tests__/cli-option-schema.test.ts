import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getOptionSpec,
  getOptionSpecForToken,
  getConfigurableOptionSpecs,
  isFlagSupportedForCommand,
  parseOptionValueFromSource,
} from '../cli-option-schema.ts';
import { AppError } from '../errors.ts';

test('option schema exposes config/env metadata for global options', () => {
  const spec = getOptionSpec('platform');
  assert.ok(spec);
  assert.equal(spec.config.enabled, true);
  assert.equal(spec.config.key, 'platform');
  assert.deepEqual(spec.env.names, ['AGENT_DEVICE_PLATFORM']);
  assert.equal(spec.supportsCommand('open'), true);
  assert.equal(spec.supportsCommand('snapshot'), true);
});

test('option schema exposes legacy env aliases and command scoping', () => {
  const spec = getOptionSpec('iosSimulatorDeviceSet');
  assert.ok(spec);
  assert.deepEqual(spec.env.names, [
    'AGENT_DEVICE_IOS_SIMULATOR_DEVICE_SET',
    'IOS_SIMULATOR_DEVICE_SET',
  ]);
  assert.equal(spec.supportsCommand('devices'), true);
  assert.equal(spec.supportsCommand('snapshot'), true);

  const snapshotDepth = getOptionSpec('snapshotDepth');
  assert.ok(snapshotDepth);
  assert.equal(snapshotDepth.supportsCommand('snapshot'), true);
  assert.equal(snapshotDepth.supportsCommand('open'), false);
});

test('configurable option specs are filtered by command support', () => {
  const openSpecs = new Set(getConfigurableOptionSpecs('open').map((spec) => spec.key));
  assert.equal(openSpecs.has('platform'), true);
  assert.equal(openSpecs.has('activity'), true);
  assert.equal(openSpecs.has('snapshotDepth'), false);

  const installFromSourceSpecs = new Set(
    getConfigurableOptionSpecs('install-from-source').map((spec) => spec.key),
  );
  assert.equal(installFromSourceSpecs.has('header'), true);
});

test('option schema resolves tokens back to canonical option specs', () => {
  const spec = getOptionSpecForToken('--config');
  assert.ok(spec);
  assert.equal(spec.key, 'config');
});

test('isFlagSupportedForCommand consults option schema support map', () => {
  assert.equal(isFlagSupportedForCommand('snapshotDepth', 'snapshot'), true);
  assert.equal(isFlagSupportedForCommand('snapshotDepth', 'open'), false);
  assert.equal(isFlagSupportedForCommand('platform', 'open'), true);
});

test('option schema parses enum options with multiple CLI aliases from env/config sources', () => {
  const spec = getOptionSpec('appsFilter');
  assert.ok(spec);
  assert.equal(
    parseOptionValueFromSource(
      spec,
      'user-installed',
      'environment variable AGENT_DEVICE_APPS_FILTER',
      'AGENT_DEVICE_APPS_FILTER',
    ),
    'user-installed',
  );
  assert.equal(
    parseOptionValueFromSource(spec, 'all', 'config file /tmp/test.json', 'appsFilter'),
    'all',
  );
  assert.throws(
    () =>
      parseOptionValueFromSource(
        spec,
        true,
        'environment variable AGENT_DEVICE_APPS_FILTER',
        'AGENT_DEVICE_APPS_FILTER',
      ),
    (error) => error instanceof AppError && error.code === 'INVALID_ARGS',
  );
});

test('option schema rejects invalid source values with INVALID_ARGS', () => {
  const spec = getOptionSpec('platform');
  assert.ok(spec);
  assert.throws(
    () => parseOptionValueFromSource(spec, 'windows', 'config file /tmp/test.json', 'platform'),
    (error) => error instanceof AppError && error.code === 'INVALID_ARGS',
  );
});

test('option schema parses repeatable string options from config arrays and env strings', () => {
  const spec = getOptionSpec('header');
  assert.ok(spec);
  assert.deepEqual(
    parseOptionValueFromSource(
      spec,
      ['authorization: Bearer token', 'x-build-id: 42'],
      'config file /tmp/test.json',
      'header',
    ),
    ['authorization: Bearer token', 'x-build-id: 42'],
  );
  assert.deepEqual(
    parseOptionValueFromSource(
      spec,
      'authorization: Bearer token',
      'environment variable AGENT_DEVICE_HEADER',
      'AGENT_DEVICE_HEADER',
    ),
    ['authorization: Bearer token'],
  );
});
