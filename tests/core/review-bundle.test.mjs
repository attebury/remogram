import { describe, it, expect } from 'vitest';
import { parseReviewBundleArgs, buildReviewBundleBody, ERROR_CODES } from '@remogram/core';

describe('review bundle helpers', () => {
  it('builds review bundle body', () => {
    const parsed = parseReviewBundleArgs({
      number: 42,
      reviewed_head_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      reviewed_base_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      decision: 'approved',
      summary: 'looks good',
    });
    const body = buildReviewBundleBody(parsed);
    expect(body.pr_number).toBe(42);
    expect(body.decision).toBe('approved');
    expect(body.bundle_ready).toBe(true);
  });

  it('rejects unsupported decision', () => {
    expect(() => parseReviewBundleArgs({ number: 9, decision: 'ship-it' })).toThrow(
      expect.objectContaining({
        forgeError: expect.objectContaining({ code: ERROR_CODES.INVALID_ARGS }),
      }),
    );
  });
});
