import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadRemoteConfigProfile,
  mergeRemoteConfigProfile,
  readRemoteConfigEnvDefaults,
  resolveRemoteConfigProfile,
  resolveRemoteConfigPath,
} from '../remote-config.ts';

test('public remote-config helpers resolve file paths and merge env defaults', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-remote-config-public-'));
  try {
    const configDir = path.join(root, 'profiles');
    const projectRoot = path.join(root, 'project');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });

    const configPath = path.join(configDir, 'demo.remote.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        platform: 'ios',
        metroProjectRoot: '../project',
        metroPublicBaseUrl: 'https://public.example.test',
      }),
      'utf8',
    );

    const env = {
      AGENT_DEVICE_METRO_PREPARE_PORT: '9090',
    };

    assert.equal(resolveRemoteConfigPath({ configPath, cwd: root, env }), configPath);

    const loaded = loadRemoteConfigProfile({ configPath, cwd: root, env });
    assert.equal(loaded.resolvedPath, configPath);
    assert.equal(loaded.profile.metroProjectRoot, projectRoot);
    assert.equal(loaded.profile.platform, 'ios');

    assert.deepEqual(readRemoteConfigEnvDefaults(env), {
      metroPreparePort: 9090,
    });

    assert.deepEqual(mergeRemoteConfigProfile({ platform: 'android' }, { platform: 'ios' }), {
      platform: 'ios',
    });

    assert.deepEqual(resolveRemoteConfigProfile({ configPath, cwd: root, env }), {
      resolvedPath: configPath,
      profile: {
        platform: 'ios',
        metroProjectRoot: projectRoot,
        metroPublicBaseUrl: 'https://public.example.test',
        metroPreparePort: 9090,
      },
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
