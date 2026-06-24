import { describe, it, expect } from 'vitest';
import {
  parseIssueOpenArgs,
  parseCrOpenWriteArgs,
  parseStatusSetArgs,
  assertWriteFieldNotTruncated,
  sanitizeWriteBodyWithMeta,
  ERROR_CODES,
  DEFAULT_FIELD_MAX_BYTES,
} from '@remogram/core';

describe('write field truncation fail-closed (#585)', () => {
  it('P585-P1 issue_open body under cap succeeds', () => {
    const parsed = parseIssueOpenArgs(
      { title: 'Plan slice', body: 'short body' },
      { fieldMaxBytes: DEFAULT_FIELD_MAX_BYTES },
    );
    expect(parsed.body).toBe('short body');
  });

  it('P585-P2 uncapped policy allows long body', () => {
    const body = 'x'.repeat(800);
    const parsed = parseIssueOpenArgs(
      { title: 'Plan slice', body },
      { uncapped: true, fieldMaxBytes: null },
    );
    expect(parsed.body).toBe(body);
  });

  it('N585-N1 issue_open body over cap fails before mutation', () => {
    expect(() =>
      parseIssueOpenArgs(
        { title: 'Plan slice', body: 'x'.repeat(600) },
        { fieldMaxBytes: DEFAULT_FIELD_MAX_BYTES },
      ),
    ).toThrow(expect.objectContaining({
      forgeError: expect.objectContaining({
        code: ERROR_CODES.WRITE_FIELD_TRUNCATED,
        fields: expect.objectContaining({ field: 'body' }),
      }),
    }));
  });

  it('N585-N2 cr_open body over cap fails before mutation', () => {
    expect(() =>
      parseCrOpenWriteArgs(
        { title: 'CR title', body: 'y'.repeat(600) },
        { fieldMaxBytes: DEFAULT_FIELD_MAX_BYTES },
      ),
    ).toThrow(expect.objectContaining({
      forgeError: expect.objectContaining({ code: ERROR_CODES.WRITE_FIELD_TRUNCATED }),
    }));
  });

  it('N585-N3 status_set description over cap fails', () => {
    expect(() =>
      parseStatusSetArgs(
        {
          sha: 'a'.repeat(40),
          context: 'ci/test',
          state: 'success',
          description: 'z'.repeat(600),
        },
        { fieldMaxBytes: DEFAULT_FIELD_MAX_BYTES },
      ),
    ).toThrow(expect.objectContaining({
      forgeError: expect.objectContaining({ code: ERROR_CODES.WRITE_FIELD_TRUNCATED }),
    }));
  });

  it('X585-X1 sanitizeWriteBodyWithMeta reports truncated without posting', () => {
    const meta = sanitizeWriteBodyWithMeta('q'.repeat(600));
    expect(meta.truncated).toBe(true);
    expect(() => assertWriteFieldNotTruncated(meta, 'body')).toThrow();
  });
});
