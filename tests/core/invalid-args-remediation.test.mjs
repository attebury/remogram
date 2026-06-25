import { describe, it, expect } from 'vitest';
import {
  resolveInvalidArgsRemediation,
  withInvalidArgsRemediation,
  forgeError,
  ERROR_CODES,
  forgeErrorPacket,
} from '@remogram/core';

const ctx = {
  providerId: 'gitea-api',
  remoteName: 'origin',
  repoId: 'owner/repo',
};

describe('invalid args remediation', () => {
  it('maps status set --number misuse to remediation', () => {
    const remediation = resolveInvalidArgsRemediation({
      group: 'status',
      sub: 'set',
      flags: { number: '123' },
    });
    expect(remediation?.hint).toMatch(/needs a commit SHA/i);
    expect(remediation?.suggested_commands).toHaveLength(2);
  });

  it('adds remediation to invalid_args forge errors', () => {
    const fe = withInvalidArgsRemediation(
      forgeError(ERROR_CODES.INVALID_ARGS, '--sha required for status set'),
      { group: 'status', sub: 'set', flags: { number: '7' } },
    );
    const packet = forgeErrorPacket(ctx, fe);
    expect(packet.error_code).toBe(ERROR_CODES.INVALID_ARGS);
    expect(packet.remediation).toMatchObject({
      hint: expect.any(String),
      suggested_commands: expect.arrayContaining([
        expect.stringContaining('status set --sha'),
      ]),
    });
  });
});
