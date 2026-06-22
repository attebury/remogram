import { describe, it, expect } from 'vitest';
import {
  normalizedForgeOrigin,
  ERROR_CODES,
  forgePacket,
  PACKET_TYPES,
  TRUSTED_ENVELOPE_FIELDS,
} from '@remogram/core';

describe('normalizedForgeOrigin', () => {
  it('returns canonical origin for localhost gitea config', () => {
    expect(normalizedForgeOrigin({ baseUrl: 'http://localhost:3000' })).toBe(
      'http://localhost:3000',
    );
  });

  it('rejects userinfo in baseUrl', () => {
    try {
      normalizedForgeOrigin({ baseUrl: 'http://user:secret@localhost:3000' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err.forgeError.code).toBe(ERROR_CODES.CONFIG_INVALID);
    }
  });

  it('rejects API path suffix in baseUrl', () => {
    try {
      normalizedForgeOrigin({ baseUrl: 'http://localhost:3000/api/v1' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err.forgeError.code).toBe(ERROR_CODES.CONFIG_INVALID);
    }
  });

  it('returns null when baseUrl is absent', () => {
    expect(normalizedForgeOrigin({})).toBeNull();
  });
});

describe('forgePacket base_url envelope', () => {
  it('includes base_url from context', () => {
    const p = forgePacket(
      PACKET_TYPES.REPO_STATUS,
      {
        providerId: 'gitea-api',
        remoteName: 'origin',
        repoId: 'owner/repo',
        baseUrl: 'http://localhost:3000',
      },
      { auth_present: true },
    );
    expect(p.base_url).toBe('http://localhost:3000');
  });

  it('lists base_url in trusted envelope fields', () => {
    expect(TRUSTED_ENVELOPE_FIELDS).toContain('base_url');
  });
});
