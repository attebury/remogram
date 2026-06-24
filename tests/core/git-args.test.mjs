import { describe, it, expect } from 'vitest';
import { assertGitRef, assertGitRemote, ERROR_CODES } from '@remogram/core';

describe('assertGitRef', () => {
  it('rejects refs starting with -', () => {
    expect(() => assertGitRef('--show-toplevel', 'head')).toThrow(/must not start with '-'/);
    try {
      assertGitRef('--show-toplevel', 'head');
    } catch (err) {
      expect(err.forgeError.code).toBe(ERROR_CODES.INVALID_ARGS);
    }
  });

  it('rejects refs containing ..', () => {
    expect(() => assertGitRef('main..evil', 'base')).toThrow(/must not contain '\.\.'/);
  });

  it('allows normal branch names', () => {
    expect(() => assertGitRef('dev/scaffold', 'head')).not.toThrow();
  });
});

describe('assertGitRemote', () => {
  it('rejects remotes starting with -', () => {
    expect(() => assertGitRemote('-v')).toThrow(/must not start with '-'/);
  });

  it('allows origin', () => {
    expect(() => assertGitRemote('origin')).not.toThrow();
  });
});
