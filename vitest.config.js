import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    exclude: ['dx/**'],
    coverage: {
      provider: 'v8',
      all: false,
      include: ['packages/remogram-core/**/*.js'],
      exclude: [
        'dx/**',
        '**/*.test.mjs',
        '**/node_modules/**',
        '**/remogram-cli/**',
        '**/remogram-mcp/**',
        '**/provider-*/**',
      ],
    },
  },
});
