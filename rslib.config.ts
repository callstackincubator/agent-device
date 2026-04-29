import path from 'node:path';
import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      syntax: 'esnext',
      dts: {
        bundle: true,
      },
      shims: {
        esm: {
          __filename: true,
        },
      },
      source: {
        entry: {
          index: 'src/index.ts',
          io: 'src/io.ts',
          artifacts: 'src/artifacts.ts',
          batch: 'src/batch.ts',
          metro: 'src/metro.ts',
          'remote-config': 'src/remote-config.ts',
          'install-source': 'src/install-source.ts',
          'android-apps': 'src/android-apps.ts',
          'android-snapshot-helper': 'src/android-snapshot-helper.ts',
          contracts: 'src/contracts.ts',
          selectors: 'src/selectors.ts',
          finders: 'src/finders.ts',
          'internal/bin': 'src/bin.ts',
          'internal/companion-tunnel': 'src/companion-tunnel.ts',
          'internal/daemon': 'src/daemon.ts',
          'internal/update-check-entry': 'src/utils/update-check-entry.ts',
        },
        tsconfigPath: 'tsconfig.lib.json',
      },
      output: {
        distPath: {
          root: path.join('dist', 'src'),
        },
        minify: true,
      },
    },
  ],
});
