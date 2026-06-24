import { describe, it, expect } from 'vitest';
import { assertCrOpenBranchRef, ERROR_CODES } from '@remogram/core';

describe('assertCrOpenBranchRef', () => {
  it('accepts plain branch names', () => {
    expect(() => assertCrOpenBranchRef('remo', '--base')).not.toThrow();
    expect(() => assertCrOpenBranchRef('implement/foo', '--head')).not.toThrow();
  });

  it('rejects remote/ref integration shapes', () => {
    expect(() => assertCrOpenBranchRef('origin/remo', '--base')).toThrow(
      expect.objectContaining({
        forgeError: expect.objectContaining({
          code: ERROR_CODES.INVALID_ARGS,
          message: expect.stringMatching(/branch name/i),
        }),
      }),
    );
  });
});
