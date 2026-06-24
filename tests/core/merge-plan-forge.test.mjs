import { describe, it, expect } from 'vitest';
import { ERROR_CODES, forgeError } from '@remogram/core';
import {
  normalizeAllowedPaths,
  applyForgePathScopeForMergePlan,
  buildMergePlanBodyFromFacts,
  buildCrFilesFromGiteaFiles,
  isMergePlanForgeScopeRethrowError,
  MERGE_PLAN_FORGE_SCOPE_RETHROW_CODES,
  resolveMergePlanOptsWithForgePaths,
} from '@remogram/core';

describe('normalizeAllowedPaths', () => {
  it('returns null for empty array', () => {
    expect(normalizeAllowedPaths([])).toBeNull();
  });

  it('returns null when only empty strings', () => {
    expect(normalizeAllowedPaths([''])).toBeNull();
  });

  it('returns null when only whitespace strings', () => {
    expect(normalizeAllowedPaths(['', '   ', '\t'])).toBeNull();
  });

  it('filters empty strings and keeps valid globs', () => {
    expect(normalizeAllowedPaths(['', 'packages/**'])).toEqual(['packages/**']);
  });

  it('trims whitespace from globs', () => {
    expect(normalizeAllowedPaths(['  packages/**  '])).toEqual(['packages/**']);
  });

  it('returns null when only globs with .. segments', () => {
    expect(normalizeAllowedPaths(['packages/../topo/**'])).toBeNull();
  });

  it('filters .. globs and keeps valid globs', () => {
    expect(normalizeAllowedPaths(['packages/../topo/**', 'packages/**'])).toEqual(['packages/**']);
  });
});

describe('applyForgePathScopeForMergePlan path_count guard', () => {
  const opts = { allowed_paths: ['packages/**'] };

  it('sets null when path_count positive but changed_paths empty', () => {
    const applied = applyForgePathScopeForMergePlan(opts, {
      changed_paths: [],
      paths_truncated: false,
      path_count: 5,
    });
    expect(applied.changed_paths).toBeNull();
  });

  it('allows empty changed_paths when path_count is zero', () => {
    const applied = applyForgePathScopeForMergePlan(opts, {
      changed_paths: [],
      paths_truncated: false,
      path_count: 0,
    });
    expect(applied.changed_paths).toEqual([]);
  });

  it('sets null when path_count exceeds changed_paths length', () => {
    const applied = applyForgePathScopeForMergePlan(opts, {
      changed_paths: ['packages/a.js'],
      paths_truncated: false,
      path_count: 5,
    });
    expect(applied.changed_paths).toBeNull();
  });

  it('sets null when changed_paths length exceeds path_count', () => {
    const applied = applyForgePathScopeForMergePlan(opts, {
      changed_paths: ['packages/a.js', 'packages/b.js'],
      paths_truncated: false,
      path_count: 1,
    });
    expect(applied.changed_paths).toBeNull();
  });

  it('normalizes changed_paths before returning', () => {
    const applied = applyForgePathScopeForMergePlan(opts, {
      changed_paths: ['./packages/foo.js'],
      paths_truncated: false,
      path_count: 1,
    });
    expect(applied.changed_paths).toEqual(['packages/foo.js']);
  });

  it('sets null when a changed path cannot normalize', () => {
    const applied = applyForgePathScopeForMergePlan(opts, {
      changed_paths: ['../outside'],
      paths_truncated: false,
      path_count: 1,
    });
    expect(applied.changed_paths).toBeNull();
  });

  it('sets null when a changed path is empty', () => {
    const applied = applyForgePathScopeForMergePlan(opts, {
      changed_paths: [''],
      paths_truncated: false,
      path_count: 1,
    });
    expect(applied.changed_paths).toBeNull();
  });

  it('sets null when changed_paths is not an array', () => {
    const applied = applyForgePathScopeForMergePlan(opts, {
      changed_paths: 'packages/foo.js',
      paths_truncated: false,
      path_count: 1,
    });
    expect(applied.changed_paths).toBeNull();
  });
});

describe('isMergePlanForgeScopeRethrowError', () => {
  it('returns true for unauthenticated_provider', () => {
    const err = Object.assign(new Error('no token'), {
      forgeError: forgeError(ERROR_CODES.UNAUTHENTICATED_PROVIDER, 'no token'),
    });
    expect(isMergePlanForgeScopeRethrowError(err)).toBe(true);
  });

  it('returns false for api_error', () => {
    const err = Object.assign(new Error('api'), {
      forgeError: forgeError(ERROR_CODES.API_ERROR, 'api'),
    });
    expect(isMergePlanForgeScopeRethrowError(err)).toBe(false);
  });

  it('returns true for oversized_raw_output', () => {
    const err = Object.assign(new Error('oversized'), {
      forgeError: forgeError(ERROR_CODES.OVERSIZED_RAW_OUTPUT, 'oversized'),
    });
    expect(isMergePlanForgeScopeRethrowError(err)).toBe(true);
  });

  it('returns true for config_not_found', () => {
    const err = Object.assign(new Error('config'), {
      forgeError: forgeError(ERROR_CODES.CONFIG_NOT_FOUND, 'config'),
    });
    expect(isMergePlanForgeScopeRethrowError(err)).toBe(true);
  });

  it('returns true for stale_head', () => {
    const err = Object.assign(new Error('stale'), {
      forgeError: forgeError(ERROR_CODES.STALE_HEAD, 'stale'),
    });
    expect(isMergePlanForgeScopeRethrowError(err)).toBe(true);
  });

  it('matches every exported rethrow code', () => {
    for (const code of MERGE_PLAN_FORGE_SCOPE_RETHROW_CODES) {
      const err = Object.assign(new Error(code), {
        forgeError: forgeError(code, code),
      });
      expect(isMergePlanForgeScopeRethrowError(err)).toBe(true);
    }
  });
});

describe('merge plan product cap path scope', () => {
  it('yields changed_paths_unavailable when cr_files hits product cap', () => {
    const files = Array.from({ length: 257 }, (_, i) => ({ filename: `p/f${i}.js` }));
    const crBody = buildCrFilesFromGiteaFiles(1, files);
    const scoped = applyForgePathScopeForMergePlan({ allowed_paths: ['p/**'] }, crBody);
    const body = buildMergePlanBodyFromFacts(
      { pr_number: 1, mergeability: 'clean', state: 'open' },
      { check_conclusion: 'success', checks_truncated: false },
      scoped,
    );
    expect(body.blockers).toContain('changed_paths_unavailable');
  });
});

describe('resolveMergePlanOptsWithForgePaths', () => {
  const opts = { allowed_paths: ['packages/**'] };

  it('passes complete forge paths', async () => {
    const applied = await resolveMergePlanOptsWithForgePaths(opts, async () => ({
      changed_paths: ['packages/foo.js'],
      paths_truncated: false,
      path_count: 1,
    }));
    expect(applied.changed_paths).toEqual(['packages/foo.js']);
  });

  it('sets null on paths_truncated', async () => {
    const applied = await resolveMergePlanOptsWithForgePaths(opts, async () => ({
      changed_paths: ['packages/foo.js'],
      paths_truncated: true,
      path_count: 300,
    }));
    expect(applied.changed_paths).toBeNull();
  });

  it.each([...MERGE_PLAN_FORGE_SCOPE_RETHROW_CODES])(
    'rethrows %s from crFiles during path scope',
    async (code) => {
      await expect(
        resolveMergePlanOptsWithForgePaths(opts, async () => {
          throw Object.assign(new Error(code), {
            forgeError: forgeError(code, code),
          });
        }),
      ).rejects.toMatchObject({
        forgeError: { code },
      });
    },
  );

  it('masks api_error as changed_paths null', async () => {
    const applied = await resolveMergePlanOptsWithForgePaths(opts, async () => {
      throw Object.assign(new Error('fail'), {
        forgeError: forgeError(ERROR_CODES.API_ERROR, 'fail'),
      });
    });
    expect(applied.changed_paths).toBeNull();
  });

  it('masks write_not_configured as changed_paths null', async () => {
    const applied = await resolveMergePlanOptsWithForgePaths(opts, async () => {
      throw Object.assign(new Error('write'), {
        forgeError: forgeError(ERROR_CODES.WRITE_NOT_CONFIGURED, 'write'),
      });
    });
    expect(applied.changed_paths).toBeNull();
  });

  it('returns opts unchanged when no allowlist', async () => {
    const bare = { number: 1 };
    const applied = await resolveMergePlanOptsWithForgePaths(bare, async () => {
      throw new Error('should not run');
    });
    expect(applied).toBe(bare);
  });

  it('sets null when crFilesFn returns null body', async () => {
    const applied = await resolveMergePlanOptsWithForgePaths(opts, async () => null);
    expect(applied.changed_paths).toBeNull();
  });
});
