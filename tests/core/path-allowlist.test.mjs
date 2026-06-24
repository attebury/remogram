import { describe, it, expect } from 'vitest';
import {
  allPathsAllowed,
  isPathAllowed,
  matchPathAllowlist,
  normalizeChangedPathList,
  normalizeRepoRelativePath,
  pathsOutsideAllowlist,
} from '@remogram/core';

const PILOT_ALLOWLIST = ['packages/**', 'tests/**', 'README.md'];

describe('normalizeRepoRelativePath', () => {
  it('collapses .. segments', () => {
    expect(normalizeRepoRelativePath('packages/../../topo/x.tg')).toBe('topo/x.tg');
    expect(normalizeRepoRelativePath('./packages/foo.js')).toBe('packages/foo.js');
  });

  it('rejects absolute paths and repo-root escape', () => {
    expect(normalizeRepoRelativePath('/etc/passwd')).toBeNull();
    expect(normalizeRepoRelativePath('../outside')).toBeNull();
    expect(normalizeRepoRelativePath('')).toBeNull();
  });
});

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

  it('rejects traversal paths that normalize outside allowlist', () => {
    expect(isPathAllowed(PILOT_ALLOWLIST, 'packages/../../topo/x.tg')).toBe(false);
    expect(pathsOutsideAllowlist(PILOT_ALLOWLIST, ['packages/../../topo/x.tg'])).toEqual([
      'packages/../../topo/x.tg',
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

describe('normalizeChangedPathList', () => {
  it('normalizes in-scope paths', () => {
    expect(normalizeChangedPathList(['packages/foo.js'])).toEqual(['packages/foo.js']);
    expect(normalizeChangedPathList(['./packages/foo.js'])).toEqual(['packages/foo.js']);
    expect(normalizeChangedPathList(['packages/a.js', 'tests/b.mjs'])).toEqual([
      'packages/a.js',
      'tests/b.mjs',
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(normalizeChangedPathList([])).toEqual([]);
  });

  it('returns null for unnormalizable paths', () => {
    expect(normalizeChangedPathList(['../outside'])).toBeNull();
    expect(normalizeChangedPathList([''])).toBeNull();
    expect(normalizeChangedPathList(['/etc/passwd'])).toBeNull();
    expect(normalizeChangedPathList(['packages/ok.js', '../bad'])).toBeNull();
  });

  it('returns null for non-array input', () => {
    expect(normalizeChangedPathList(null)).toBeNull();
    expect(normalizeChangedPathList('packages/x')).toBeNull();
  });

  it('rejects any .. segment in forge changed paths', () => {
    expect(normalizeChangedPathList(['topo/../packages/x.js'])).toBeNull();
    expect(normalizeChangedPathList(['packages/../../topo/x.tg'])).toBeNull();
  });
});
