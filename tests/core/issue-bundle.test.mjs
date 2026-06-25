import { describe, it, expect } from 'vitest';
import { parseIssueBundleArgs, buildIssueBundleBody, ERROR_CODES } from '@remogram/core';

describe('issue bundle helpers', () => {
  it('builds issue bundle body', () => {
    const parsed = parseIssueBundleArgs({
      issue_number: 514,
      state: 'closed',
      title: 'Bug fixed',
      url: 'http://localhost:3000/o/r/issues/514',
      linked_pr: 88,
    });
    const body = buildIssueBundleBody(parsed);
    expect(body.issue_number).toBe(514);
    expect(body.state).toBe('closed');
    expect(body.linked_pr).toBe(88);
    expect(body.bundle_ready).toBe(true);
  });

  it('requires positive issue number', () => {
    expect(() => parseIssueBundleArgs({ issue_number: 0 })).toThrow(
      expect.objectContaining({
        forgeError: expect.objectContaining({ code: ERROR_CODES.INVALID_ARGS }),
      }),
    );
  });
});
