import { describe, it, expect } from 'vitest';
import {
  mergeEndpointRecoveryHints,
  forgeErrorPacket,
  forgeError,
  ERROR_CODES,
} from '@remogram/core';

const ctx = {
  providerId: 'gitea-api',
  remoteName: 'origin',
  repoId: 'owner/repo',
};

describe('merge endpoint recovery hints', () => {
  it('builds bounded recovery command suggestions', () => {
    const recovery = mergeEndpointRecoveryHints(7, {
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
    expect(recovery.suggested_commands).toHaveLength(3);
    expect(recovery.suggested_commands[2]).toMatch(/merge execute --number 7/);
  });

  it('forge_error packet keeps merge_endpoint_failed recovery fields', () => {
    const packet = forgeErrorPacket(
      ctx,
      forgeError(
        ERROR_CODES.MERGE_ENDPOINT_FAILED,
        'Forge merge request failed',
        500,
        { recovery: mergeEndpointRecoveryHints(9, {}) },
      ),
    );
    expect(packet.error_code).toBe(ERROR_CODES.MERGE_ENDPOINT_FAILED);
    expect(packet.recovery?.suggested_commands).toHaveLength(3);
  });
});
