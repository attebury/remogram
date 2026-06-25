import { describe, it, expect } from 'vitest';
import { parseVerifyBindArgs, buildVerifyBindBody, ERROR_CODES } from '@remogram/core';

describe('verify bind helpers', () => {
  it('parses verify bind args and marks packet as bound', () => {
    const parsed = parseVerifyBindArgs({
      target_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      verifier: 'verify-lane',
      proof_url: 'http://localhost:3000/proof/1',
      note: 'verified in lane',
    });
    const body = buildVerifyBindBody(parsed);
    expect(body.target_sha).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(body.bound).toBe(true);
    expect(body.verifier).toBe('verify-lane');
  });

  it('requires target sha', () => {
    expect(() => parseVerifyBindArgs({ verifier: 'verify-lane' })).toThrow(
      expect.objectContaining({
        forgeError: expect.objectContaining({ code: ERROR_CODES.INVALID_ARGS }),
      }),
    );
  });
});
