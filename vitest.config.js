import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    exclude: ['dx/**'],
  },
  coverage: {
    provider: 'v8',
    include: ['packages/remogram-core/**/*.js'],
    exclude: ['dx/**', '**/*.test.mjs', '**/node_modules/**'],
  },
});
