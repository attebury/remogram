import { describe, it, expect } from 'vitest';
import {
  buildProviderIdentityBody,
  buildProviderIdentityFromGiteaUser,
  buildProviderIdentityFromGitHubUser,
  buildProviderIdentityFromGitLabUser,
  parseGitLabPatSelfSignals,
  parseGitHubOAuthScopes,
  githubCanWriteFromScopes,
  normalizeGiteaCanWrite,
  forgePacket,
  PACKET_TYPES,
  FORBIDDEN_PACKET_KEYS,
} from '@remogram/core';

const ctx = {
  providerId: 'gitea-api',
  remoteName: 'origin',
  repoId: 'owner/repo',
};

describe('whoami normalization', () => {
  it('builds provider_identity body from Gitea user payload', () => {
    const body = buildProviderIdentityFromGiteaUser({
      login: 'agent-user',
      restricted: false,
    });
    expect(body.login).toBe('agent-user');
    expect(body.can_write).toBe(true);
    expect(body.token_scope_signal).toEqual({ implemented: false, scopes: null });
    expect(body.token_expiry_signal).toEqual({ implemented: false, expires_at: null });
  });

  it('restricted Gitea users are not writable', () => {
    expect(normalizeGiteaCanWrite({ restricted: true })).toBe(false);
    expect(buildProviderIdentityFromGiteaUser({ login: 'ro', restricted: true }).can_write).toBe(false);
  });

  it('parses GitHub OAuth scopes from response header', () => {
    expect(parseGitHubOAuthScopes('repo, read:user')).toEqual({
      implemented: true,
      scopes: ['repo', 'read:user'],
    });
    expect(parseGitHubOAuthScopes('')).toEqual({ implemented: false, scopes: null });
    expect(githubCanWriteFromScopes({ implemented: true, scopes: ['read:user'] })).toBe(false);
    expect(githubCanWriteFromScopes({ implemented: true, scopes: ['public_repo'] })).toBe(true);
  });

  it('builds provider_identity from GitHub user and scope header', () => {
    const body = buildProviderIdentityFromGitHubUser({ login: 'octocat' }, 'repo, read:user');
    expect(body.login).toBe('octocat');
    expect(body.can_write).toBe(true);
    expect(body.token_scope_signal.implemented).toBe(true);
    expect(body.token_expiry_signal.implemented).toBe(false);
  });

  it('builds provider_identity from GitLab user and PAT self endpoint', () => {
    const body = buildProviderIdentityFromGitLabUser(
      { username: 'gitlab-agent', state: 'active', can_create_project: true },
      { scopes: ['api', 'read_user'], expires_at: '2027-01-15T12:00:00.000Z' },
    );
    expect(body.login).toBe('gitlab-agent');
    expect(body.can_write).toBe(true);
    expect(body.token_scope_signal).toEqual({
      implemented: true,
      scopes: ['api', 'read_user'],
    });
    expect(body.token_expiry_signal.implemented).toBe(true);
    expect(body.token_expiry_signal.expires_at).toBe('2027-01-15T12:00:00.000Z');
  });

  it('GitLab PAT self absent yields honest unimplemented signals', () => {
    const signals = parseGitLabPatSelfSignals(null);
    expect(signals.token_scope_signal.implemented).toBe(false);
    expect(signals.token_expiry_signal.implemented).toBe(false);
  });

  it('sanitizes login and strips forbidden workflow keys from packet', () => {
    const body = buildProviderIdentityBody({
      login: 'user\ninjected',
      can_write: true,
      token_scope_signal: { implemented: false, scopes: null },
      token_expiry_signal: { implemented: false, expires_at: null },
    });
    const packet = forgePacket(PACKET_TYPES.PROVIDER_IDENTITY, ctx, body);
    expect(packet.type).toBe('provider_identity');
    expect(packet.login).not.toContain('\n');
    for (const key of FORBIDDEN_PACKET_KEYS) {
      expect(packet[key]).toBeUndefined();
    }
  });
});
