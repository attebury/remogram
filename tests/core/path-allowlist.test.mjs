import { describe, it, expect } from 'vitest';
import {
  allPathsAllowed,
  isPathAllowed,
  matchPathAllowlist,
  pathsOutsideAllowlist,
} from '@remogram/core';

const PILOT_ALLOWLIST = ['packages/**', 'tests/**', 'README.md'];

describe('path allowlist', () => {
  it('matches packages and tests globs', () => {
    expect(matchPathAllowlist('packages/**', 'packages/remogram-core/foo.js')).toBe(true);
    expect(matchPathAllowlist('tests/**', 'tests/core/bar.test.mjs')).toBe(true);
    expect(isPathAllowed(PILOT_ALLOWLIST, 'packages/remogram-core/foo.js')).toBe(true);
  });

  it('rejects paths outside allowlist', () => {
    expect(isPathAllowed(PILOT_ALLOWLIST, 'topo/sdlc/foo.tg')).toBe(false);
    expect(pathsOutsideAllowlist(PILOT_ALLOWLIST, ['packages/a.js', 'topo/sdlc/x.tg'])).toEqual([
      'topo/sdlc/x.tg',
    ]);
  });

  it('fail-closed on empty allowlist', () => {
    expect(allPathsAllowed([], ['packages/a.js'])).toBe(false);
    expect(pathsOutsideAllowlist([], ['packages/a.js'])).toEqual(['packages/a.js']);
  });

  it('matches root README.md literal glob', () => {
    expect(isPathAllowed(PILOT_ALLOWLIST, 'README.md')).toBe(true);
    expect(isPathAllowed(PILOT_ALLOWLIST, 'docs/README.md')).toBe(false);
  });
});
