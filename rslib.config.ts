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
          artifacts: 'src/artifacts.ts',
          metro: 'src/metro.ts',
          'remote-config': 'src/remote-config.ts',
          'install-source': 'src/install-source.ts',
          'android-apps': 'src/android-apps.ts',
          contracts: 'src/contracts.ts',
          selectors: 'src/selectors.ts',
          finders: 'src/finders.ts',
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
    {
      format: 'esm',
      syntax: 'esnext',
      dts: false,
      shims: {
        esm: {
          __filename: true,
        },
      },
      source: {
        entry: {
          bin: 'src/bin.ts',
          'metro-companion': 'src/metro-companion.ts',
          daemon: 'src/daemon.ts',
          'update-check-entry': 'src/utils/update-check-entry.ts',
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
