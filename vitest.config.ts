import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/integration/device-lab/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/**/*-types.ts',
        'src/**/types.ts',
        'src/android-adb.ts',
        'src/artifacts.ts',
        'src/batch.ts',
        'src/bin.ts',
        'src/client-types.ts',
        'src/core/interactor-types.ts',
        'src/index.ts',
        'src/install-source.ts',
        'src/remote-config.ts',
        'src/selectors.ts',
      ],
    },
  },
});
