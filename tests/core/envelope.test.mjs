import { describe, it, expect } from 'vitest';
import {
  SCHEMA_VERSION,
  PACKET_TYPES,
  forgePacket,
  forgeErrorPacket,
  FORBIDDEN_PACKET_KEYS,
  capText,
  parseConfigFile,
  parseRemoteUrl,
  trustedBaseUrl,
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
    expect(p.remote_name).toBe('origin');
    expect(p.repo_id).toBe('owner/repo');
    expect(p.observed_at).toMatch(/^\d{4}-/);
    expect(p.ok).toBe(true);
    expect(p.auth_present).toBe(true);
  });

  it('rejects Topogram concept keys', () => {
    expect(() => forgePacket(PACKET_TYPES.PR_STATUS, ctx, { lane: 'Merge' })).toThrow(
      /Forbidden Topogram concept/,
    );
  });

  it('forgeErrorPacket sets ok false', () => {
    const p = forgeErrorPacket(ctx, { code: ERROR_CODES.CONFIG_INVALID, message: 'bad' });
    expect(p.ok).toBe(false);
    expect(p.error_code).toBe('config_invalid');
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
  it('requires explicit provider', () => {
    const cfg = parseConfigFile(
      JSON.stringify({
        version: '1',
        provider: 'gitea-api',
        owner: 'a',
        repo: 'b',
        baseUrl: 'http://localhost:3000',
      }),
    );
    expect(cfg.provider).toBe('gitea-api');
  });

  it('rejects unknown provider', () => {
    expect(() =>
      parseConfigFile(JSON.stringify({ version: '1', provider: 'gitea', owner: 'a', repo: 'b' })),
    ).toThrow();
  });
});

describe('parseRemoteUrl', () => {
  it('parses https nested owner', () => {
    const p = parseRemoteUrl('https://localhost:3000/org/sub/remogram.git');
    expect(p.owner).toBe('org/sub');
    expect(p.repo).toBe('remogram');
    expect(p.host).toBe('localhost:3000');
  });

  it('parses ssh', () => {
    const p = parseRemoteUrl('git@github.com:owner/repo.git');
    expect(p.owner).toBe('owner');
    expect(p.repo).toBe('repo');
  });
});

describe('trustedBaseUrl', () => {
  it('fails closed when hosts mismatch', () => {
    const config = { baseUrl: 'http://evil:3000', trustedHosts: [] };
    expect(trustedBaseUrl(config, 'localhost:3000')).toBe(false);
  });

  it('allows trustedHosts override', () => {
    const config = {
      baseUrl: 'http://localhost:3000',
      trustedHosts: ['localhost:3000'],
    };
    expect(trustedBaseUrl(config, '127.0.0.1:3000')).toBe(true);
  });
});
