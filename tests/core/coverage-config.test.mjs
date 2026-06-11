import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vitestConfig from '../../vitest.config.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');

/** Documented policy — drift changes should update README and ACs. */
export const DOCUMENTED_COVERAGE_INCLUDE = ['packages/remogram-core/**/*.js'];
export const DOCUMENTED_COVERAGE_EXCLUDE = [
  'dx/**',
  '**/*.test.mjs',
  '**/node_modules/**',
  '**/remogram-cli/**',
  '**/remogram-mcp/**',
  '**/provider-*/**',
];

describe('vitest coverage scope', () => {
  it('includes only remogram-core sources by intentional policy', () => {
    const { include = [], exclude = [] } = vitestConfig.test?.coverage ?? {};
    expect(include).toEqual(DOCUMENTED_COVERAGE_INCLUDE);
    expect(exclude).toEqual(expect.arrayContaining(DOCUMENTED_COVERAGE_EXCLUDE));
    const joined = include.join(' ');
    expect(joined).not.toMatch(/remogram-mcp|provider-/);
    expect(exclude.join(' ')).toMatch(/provider-\*/);
  });

  it('uses v8 with all:false and no enforced thresholds (silent drift guard)', () => {
    const coverage = vitestConfig.test?.coverage ?? {};
    expect(coverage.provider).toBe('v8');
    expect(coverage.all).toBe(false);
    expect(coverage.thresholds).toBeUndefined();
  });

  it('README Testing section documents MCP vs core coverage policy', () => {
    expect(readme).toMatch(/Coverage policy/i);
    expect(readme).toMatch(/@remogram\/core/);
    expect(readme).toMatch(/@remogram\/mcp.*excluded|excluded.*@remogram\/mcp/is);
    expect(readme).toMatch(/Thresholds.*none|no enforced/i);
    expect(readme).toMatch(/coverage-config\.test\.mjs/);
  });
});
