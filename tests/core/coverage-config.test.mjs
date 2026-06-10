import { describe, it, expect } from 'vitest';
import vitestConfig from '../../vitest.config.js';

describe('vitest coverage scope', () => {
  it('includes only remogram-core sources by intentional policy', () => {
    const { include = [], exclude = [] } = vitestConfig.test?.coverage ?? {};
    expect(include).toEqual(['packages/remogram-core/**/*.js']);
    expect(exclude).toEqual(
      expect.arrayContaining([
        '**/remogram-cli/**',
        '**/remogram-mcp/**',
        '**/provider-*/**',
        'dx/**',
        '**/*.test.mjs',
      ]),
    );
    const joined = include.join(' ');
    expect(joined).not.toMatch(/remogram-mcp|provider-/);
    expect(exclude.join(' ')).toMatch(/provider-\*/);
  });
});
