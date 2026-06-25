import { describe, it, expect } from 'vitest';
import {
  STATUS_SET_STATES,
  assertCommitSha,
  normalizeStatusSetState,
  parseStatusSetArgs,
  buildCommitStatusSetBody,
  forgePacket,
  PACKET_TYPES,
  FORBIDDEN_PACKET_KEYS,
  ERROR_CODES,
} from '@remogram/core';

const ctx = {
  providerId: 'gitea-api',
  remoteName: 'origin',
  repoId: 'owner/repo',
};

const SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('status set core', () => {
  it('STATUS_SET_STATES matches Gitea/GitHub vocabulary', () => {
    expect(STATUS_SET_STATES).toEqual(['pending', 'success', 'failure', 'error']);
  });

  it('assertCommitSha accepts 40-char hex and lowercases', () => {
    expect(assertCommitSha('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe(SHA);
  });

  it('assertCommitSha rejects short or non-hex sha', () => {
    expect(() => assertCommitSha('abc123')).toThrow(
      expect.objectContaining({
        forgeError: expect.objectContaining({ code: ERROR_CODES.INVALID_ARGS }),
      }),
    );
  });

  it('parseStatusSetArgs validates required fields and normalizes state', () => {
    const args = parseStatusSetArgs({
      sha: SHA,
      context: 'verify/wave1',
      state: 'SUCCESS',
      target_url: 'http://localhost:3000/checks/1',
      description: 'ok',
    });
    expect(args).toEqual({
      sha: SHA,
      context: 'verify/wave1',
      state: 'success',
      target_url: 'http://localhost:3000/checks/1',
      description: 'ok',
    });
  });

  it('parseStatusSetArgs rejects unsupported state', () => {
    expect(() =>
      parseStatusSetArgs({ sha: SHA, context: 'ci/gate', state: 'unknown' }),
    ).toThrow(
      expect.objectContaining({
        forgeError: expect.objectContaining({ code: ERROR_CODES.INVALID_ARGS }),
      }),
    );
  });

  it('buildCommitStatusSetBody maps forge response', () => {
    const args = parseStatusSetArgs({
      sha: SHA,
      context: 'verify/wave1',
      state: 'success',
    });
    const body = buildCommitStatusSetBody(
      {
        status: 'success',
        context: 'verify/wave1',
        description: 'From API',
        target_url: 'http://localhost:3000/checks/1',
      },
      args,
    );
    expect(body).toEqual({
      sha: SHA,
      context: 'verify/wave1',
      state: 'success',
      description: 'From API',
      target_url: 'http://localhost:3000/checks/1',
      created: true,
    });
  });

  it('buildCommitStatusSetBody sets reused_existing when reusing', () => {
    const args = parseStatusSetArgs({
      sha: SHA,
      context: 'verify/wave1',
      state: 'pending',
    });
    const body = buildCommitStatusSetBody(
      { status: 'pending', context: 'verify/wave1' },
      args,
      { reusedExisting: true },
    );
    expect(body.reused_existing).toBe(true);
  });

  it('normalizeStatusSetState maps pass alias to success', () => {
    expect(normalizeStatusSetState('pass')).toBe('success');
  });

  it('commit_status_set packet excludes forbidden keys', () => {
    const packet = forgePacket(PACKET_TYPES.COMMIT_STATUS_SET, ctx, {
      sha: SHA,
      context: 'verify/wave1',
      state: 'success',
      reused_existing: true,
    });
    for (const key of FORBIDDEN_PACKET_KEYS) {
      expect(packet).not.toHaveProperty(key);
    }
    expect(packet.type).toBe('commit_status_set');
    expect(packet.ok).toBe(true);
  });
});
