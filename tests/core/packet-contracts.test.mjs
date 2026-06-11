import { describe, it, expect } from 'vitest';
import { forgePacket, PACKET_TYPES, SCHEMA_VERSION } from '@remogram/core';

const ctx = {
  providerId: 'gitea-api',
  remoteName: 'origin',
  repoId: 'owner/repo',
};

const ENVELOPE_KEYS = [
  'type',
  'schema_version',
  'provider_id',
  'remote_name',
  'repo_id',
  'observed_at',
  'ok',
];

function bodyKeys(packet) {
  return Object.keys(packet).filter((k) => !ENVELOPE_KEYS.includes(k)).sort();
}

describe('packet contracts', () => {
  it('repo_status', () => {
    const p = forgePacket(PACKET_TYPES.REPO_STATUS, ctx, {
      auth_present: true,
      auth_env: 'GITEA_TOKEN',
      capabilities: ['repo_status'],
      default_branch: 'main',
    });
    expect(p.type).toBe('repo_status');
    expect(p.schema_version).toBe(SCHEMA_VERSION);
    expect(p.ok).toBe(true);
    expect(bodyKeys(p)).toEqual(['auth_env', 'auth_present', 'capabilities', 'default_branch']);
  });

  it('ref_compare', () => {
    const p = forgePacket(PACKET_TYPES.REF_COMPARE, ctx, {
      base_ref: 'main',
      base_sha: 'aaa',
      head_ref: 'feat',
      head_sha: 'bbb',
      ahead_by: 1,
      behind_by: 0,
    });
    expect(p.type).toBe('ref_compare');
    expect(bodyKeys(p)).toEqual(['ahead_by', 'base_ref', 'base_sha', 'behind_by', 'head_ref', 'head_sha']);
  });

  it('pr_status', () => {
    const p = forgePacket(PACKET_TYPES.PR_STATUS, ctx, {
      pr_number: 1,
      url: 'http://localhost:3000/o/r/pulls/1',
      title: 'T',
      state: 'open',
      mergeability: 'clean',
    });
    expect(p.type).toBe('pr_status');
    expect(bodyKeys(p)).toEqual(['mergeability', 'pr_number', 'state', 'title', 'url']);
  });

  it('pr_checks', () => {
    const p = forgePacket(PACKET_TYPES.PR_CHECKS, ctx, {
      head_sha: 'bbb',
      check_conclusion: 'success',
      statuses: [{ context: 'ci', state: 'success', description: 'ok' }],
    });
    expect(p.type).toBe('pr_checks');
    expect(bodyKeys(p)).toEqual(['check_conclusion', 'head_sha', 'statuses']);
  });

  it('merge_plan', () => {
    const p = forgePacket(PACKET_TYPES.MERGE_PLAN, ctx, {
      pr_number: 1,
      mergeability: 'clean',
      checks_conclusion: 'success',
      blockers: [],
    });
    expect(p.type).toBe('merge_plan');
    expect(bodyKeys(p)).toEqual(['blockers', 'checks_conclusion', 'mergeability', 'pr_number']);
  });

  it('sync_plan', () => {
    const p = forgePacket(PACKET_TYPES.SYNC_PLAN, ctx, {
      remote: 'origin',
      local_sha: 'aaa',
      remote_sha: 'aaa',
      diverged: false,
      blockers: [],
    });
    expect(p.type).toBe('sync_plan');
    expect(bodyKeys(p)).toEqual(['blockers', 'diverged', 'local_sha', 'remote', 'remote_sha']);
  });

  it('provider_capabilities', () => {
    const p = forgePacket(PACKET_TYPES.PROVIDER_CAPABILITIES, ctx, {
      commands: [{ name: 'repo_status', implemented: true }],
      auth_envs: ['GITEA_TOKEN'],
      check_sources: ['commit_statuses'],
      mergeability_confidence: 'direct',
      host_binding: 'trusted_base_url',
      pagination: 'first_page_only',
      write_support: false,
      forge_ingest_cap_bytes: 8192,
    });
    expect(p.type).toBe('provider_capabilities');
    expect(bodyKeys(p)).toEqual([
      'auth_envs',
      'check_sources',
      'commands',
      'forge_ingest_cap_bytes',
      'host_binding',
      'mergeability_confidence',
      'pagination',
      'write_support',
    ]);
  });

  it('provider_doctor', () => {
    const p = forgePacket(PACKET_TYPES.PROVIDER_DOCTOR, ctx, {
      summary: 'warn',
      checks: [{ name: 'auth', status: 'warn', message: 'No provider auth environment variable is set' }],
      provider_capabilities: null,
    });
    expect(p.type).toBe('provider_doctor');
    expect(bodyKeys(p)).toEqual(['checks', 'provider_capabilities', 'summary']);
  });

  it('forge_error', () => {
    const p = forgePacket(
      'forge_error',
      ctx,
      {},
      { code: 'config_not_found', message: 'missing' },
    );
    expect(p.type).toBe('forge_error');
    expect(p.ok).toBe(false);
    expect(bodyKeys(p)).toEqual(['error_code', 'error_message']);
  });
});
