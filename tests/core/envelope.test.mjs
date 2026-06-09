import { describe, it, expect } from 'vitest';
import {
  SCHEMA_VERSION,
  PACKET_TYPES,
  forgePacket,
  forgeErrorPacket,
  capText,
  sanitizeField,
  parseConfigFile,
  parseRemoteUrl,
  trustedBaseUrl,
  assertConfigMatchesRemote,
  ERROR_CODES,
} from '@remogram/core';

const ctx = {
  providerId: 'gitea-api',
  remoteName: 'origin',
  repoId: 'owner/repo',
};

describe('forgePacket', () => {
  it('includes required envelope fields', () => {
    const p = forgePacket(PACKET_TYPES.REPO_STATUS, ctx, { auth_present: true });
    expect(p.type).toBe('repo_status');
    expect(p.schema_version).toBe(SCHEMA_VERSION);
    expect(p.provider_id).toBe('gitea-api');
    expect(p.ok).toBe(true);
  });

  it('rejects forbidden keys at any depth', () => {
    expect(() => forgePacket(PACKET_TYPES.PR_STATUS, ctx, { meta: { lane: 'Merge' } })).toThrow(
      /Forbidden Topogram concept/,
    );
  });

  it('forgeErrorPacket uses forge_error type by default', () => {
    const p = forgeErrorPacket(ctx, { code: ERROR_CODES.CONFIG_INVALID, message: 'bad' });
    expect(p.type).toBe('forge_error');
    expect(p.ok).toBe(false);
  });
});

describe('sanitizeField', () => {
  it('collapses newlines', () => {
    expect(sanitizeField('hello\nworld')).toBe('hello world');
  });
});

describe('capText', () => {
  it('truncates utf-8 safely', () => {
    const emoji = '😀'.repeat(100);
    const { truncated, bytes } = capText(emoji, 10);
    expect(truncated).toBe(true);
    expect(bytes).toBeLessThanOrEqual(10);
  });
});

describe('parseConfigFile', () => {
  it('rejects owner with slash', () => {
    expect(() =>
      parseConfigFile(
        JSON.stringify({
          version: '1',
          provider: 'gitea-api',
          owner: 'org/sub',
          repo: 'r',
        }),
      ),
    ).toThrow();
  });
});

describe('trustedBaseUrl', () => {
  it('fails closed when hosts mismatch with empty trustedHosts', () => {
    expect(trustedBaseUrl({ baseUrl: 'http://evil:3000', trustedHosts: [] }, 'localhost:3000')).toBe(
      false,
    );
  });

  it('rejects evil.com even when trustedHosts lists config host', () => {
    const config = {
      baseUrl: 'http://localhost:3000',
      trustedHosts: ['localhost:3000'],
    };
    expect(trustedBaseUrl(config, 'evil.com')).toBe(false);
  });

  it('allows explicit trustedHosts match on remote host', () => {
    const config = {
      baseUrl: 'http://localhost:3000',
      trustedHosts: ['127.0.0.1:3000'],
    };
    expect(trustedBaseUrl(config, '127.0.0.1:3000')).toBe(true);
  });

  it('allows localhost and 127.0.0.1 alias without trustedHosts', () => {
    expect(
      trustedBaseUrl({ baseUrl: 'http://localhost:3000' }, '127.0.0.1:3000'),
    ).toBe(true);
  });
});

describe('assertConfigMatchesRemote', () => {
  it('throws on owner/repo mismatch', () => {
    expect(() =>
      assertConfigMatchesRemote(
        { owner: 'a', repo: 'b' },
        { owner: 'c', repo: 'b', host: 'x' },
      ),
    ).toThrow(/does not match git remote/);
  });
});

describe('parseRemoteUrl', () => {
  it('parses https nested owner', () => {
    const p = parseRemoteUrl('https://localhost:3000/org/sub/remogram.git');
    expect(p.owner).toBe('org/sub');
    expect(p.repo).toBe('remogram');
  });
});
