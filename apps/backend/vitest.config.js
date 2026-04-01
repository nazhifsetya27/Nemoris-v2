import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 10000,
    hookTimeout: 10000,
    include: ['src/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/services/**', 'src/handlers/**', 'src/config/waha.js'],
    },
  },
});
