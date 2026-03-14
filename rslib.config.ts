import path from 'node:path';
import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      syntax: 'esnext',
      dts: true,
      shims: {
        esm: {
          __filename: true,
        },
      },
      source: {
        entry: {
          index: 'src/index.ts',
          bin: 'src/bin.ts',
          daemon: 'src/daemon.ts',
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
