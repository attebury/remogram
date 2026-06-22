import { describe, it, expect } from 'vitest';
import {
  forgePacket,
  forgeErrorPacket,
  PACKET_TYPES,
  SCHEMA_VERSION,
  buildCrMergedBody,
  buildCrMergeBlockedBody,
} from '@remogram/core';
import {
  PR_STATUS_BODY_KEYS,
  PR_STATUS_OPTIONAL_BODY_KEYS,
} from '../helpers/pr-status-contract-keys.mjs';

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
  'base_url',
  'observed_at',
  'ok',
];

function bodyKeys(packet) {
  return Object.keys(packet).filter((k) => !ENVELOPE_KEYS.includes(k)).sort();
}

const BASE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HEAD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

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
      compare_base_ref: 'main',
      compare_base_sha: 'aaa',
      compare_head_ref: 'feat',
      compare_head_sha: 'bbb',
      ahead_by: 1,
      behind_by: 0,
    });
    expect(p.type).toBe('ref_compare');
    expect(bodyKeys(p)).toEqual(['ahead_by', 'behind_by', 'compare_base_ref', 'compare_base_sha', 'compare_head_ref', 'compare_head_sha']);
  });

  it('pr_status', () => {
    const p = forgePacket(PACKET_TYPES.PR_STATUS, ctx, {
      pr_number: 1,
      url: 'http://localhost:3000/o/r/pulls/1',
      title: 'T',
      state: 'open',
      mergeability: 'clean',
      forge_target_branch_ref: 'remo',
      forge_target_sha: BASE,
      forge_source_branch_ref: 'feat/x',
      forge_source_sha: HEAD,
    });
    expect(p.type).toBe('pr_status');
    expect(bodyKeys(p)).toEqual(PR_STATUS_BODY_KEYS);
  });

  it('pr_status with optional forge_source_repo_id', () => {
    const p = forgePacket(PACKET_TYPES.PR_STATUS, ctx, {
      pr_number: 2,
      url: 'http://localhost:3000/o/r/pulls/2',
      title: 'Fork PR',
      state: 'open',
      mergeability: 'clean',
      forge_target_branch_ref: 'remo',
      forge_target_sha: BASE,
      forge_source_branch_ref: 'feature/x',
      forge_source_sha: HEAD,
      forge_source_repo_id: 'forker/fork',
    });
    expect(p.type).toBe('pr_status');
    expect(bodyKeys(p)).toEqual([...PR_STATUS_BODY_KEYS, ...PR_STATUS_OPTIONAL_BODY_KEYS].sort());
  });

  it('pr_checks', () => {
    const p = forgePacket(PACKET_TYPES.PR_CHECKS, ctx, {
      forge_source_sha: 'bbb',
      check_conclusion: 'success',
      checks_truncated: false,
      statuses: [{ context: 'ci', state: 'success', description: 'ok' }],
    });
    expect(p.type).toBe('pr_checks');
    expect(bodyKeys(p)).toEqual(['check_conclusion', 'checks_truncated', 'forge_source_sha', 'statuses']);
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

  it('provider_identity', () => {
    const p = forgePacket(PACKET_TYPES.PROVIDER_IDENTITY, ctx, {
      login: 'agent-user',
      can_write: true,
      token_scope_signal: { implemented: false, scopes: null },
      token_expiry_signal: { implemented: false, expires_at: null },
    });
    expect(p.type).toBe('provider_identity');
    expect(bodyKeys(p)).toEqual([
      'can_write',
      'login',
      'token_expiry_signal',
      'token_scope_signal',
    ]);
  });

  it('branch_protection', () => {
    const p = forgePacket(PACKET_TYPES.BRANCH_PROTECTION, ctx, {
      branch_ref: 'remo',
      required_status_contexts: ['ci/test'],
      protected_branch_rules: [{ name: 'remo' }],
      approvals_required: { implemented: true, count: 1 },
    });
    expect(p.type).toBe('branch_protection');
    expect(bodyKeys(p)).toEqual([
      'approvals_required',
      'branch_ref',
      'protected_branch_rules',
      'required_status_contexts',
    ]);
  });

  it('cr_files', () => {
    const p = forgePacket(PACKET_TYPES.CR_FILES, ctx, {
      pr_number: 1,
      changed_paths: ['packages/foo.js'],
      paths_truncated: false,
      path_count: 1,
    });
    expect(p.type).toBe('cr_files');
    expect(bodyKeys(p)).toEqual(['changed_paths', 'path_count', 'paths_truncated', 'pr_number']);
  });

  it('cr_comments', () => {
    const p = forgePacket(PACKET_TYPES.CR_COMMENTS, ctx, {
      pr_number: 1,
      comments: [
        {
          id: '1',
          author: 'reviewer',
          path: 'packages/foo.js',
          line: 10,
          body: 'Fix this.',
          resolved: false,
        },
      ],
      comments_truncated: false,
      comment_count: 1,
    });
    expect(p.type).toBe('cr_comments');
    expect(bodyKeys(p)).toEqual(['comment_count', 'comments', 'comments_truncated', 'pr_number']);
  });

  it('forge_changes', () => {
    const p = forgePacket(PACKET_TYPES.FORGE_CHANGES, ctx, {
      since: '2024-06-01T12:00:00.000Z',
      since_kind: 'observed_at',
      events: [{ kind: 'pr_opened', pr_number: 1, state: 'open' }],
      events_truncated: false,
      event_count: 1,
    });
    expect(p.type).toBe('forge_changes');
    expect(bodyKeys(p)).toEqual([
      'event_count',
      'events',
      'events_truncated',
      'since',
      'since_kind',
    ]);
  });

  it('provider_capabilities', () => {
    const p = forgePacket(PACKET_TYPES.PROVIDER_CAPABILITIES, ctx, {
      commands: [{ name: 'repo_status', implemented: true, auth_class: 'none' }],
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

  it('change_request_opened', () => {
    const p = forgePacket(PACKET_TYPES.CHANGE_REQUEST_OPENED, ctx, {
      pr_number: 99,
      url: 'http://localhost:3000/o/r/pulls/99',
      head: 'impl/x',
      base: 'remo',
      title: 'Open CR',
      created: true,
    });
    expect(p.type).toBe('change_request_opened');
    expect(bodyKeys(p)).toEqual(['base', 'created', 'head', 'pr_number', 'title', 'url']);
  });

  it('change_request_opened with idempotency fingerprint', () => {
    const p = forgePacket(PACKET_TYPES.CHANGE_REQUEST_OPENED, ctx, {
      pr_number: 99,
      url: 'http://localhost:3000/o/r/pulls/99',
      head: 'impl/x',
      base: 'remo',
      title: 'Open CR',
      created: true,
      idempotency_fingerprint: 'abc123def4567890',
    });
    expect(bodyKeys(p)).toEqual([
      'base',
      'created',
      'head',
      'idempotency_fingerprint',
      'pr_number',
      'title',
      'url',
    ]);
  });

  it('change_request_opened with reused_existing', () => {
    const p = forgePacket(PACKET_TYPES.CHANGE_REQUEST_OPENED, ctx, {
      pr_number: 42,
      url: 'http://localhost:3000/o/r/pulls/42',
      head: 'impl/x',
      base: 'remo',
      title: 'Forge title',
      reused_existing: true,
    });
    expect(bodyKeys(p)).toEqual(['base', 'head', 'pr_number', 'reused_existing', 'title', 'url']);
    expect(p.reused_existing).toBe(true);
  });

  it('commit_status_set with created and idempotency fingerprint', () => {
    const p = forgePacket(PACKET_TYPES.COMMIT_STATUS_SET, ctx, {
      sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      context: 'verify/wave1',
      state: 'success',
      created: true,
      idempotency_fingerprint: 'abc123def4567890',
    });
    expect(p.type).toBe('commit_status_set');
    expect(bodyKeys(p)).toEqual([
      'context',
      'created',
      'idempotency_fingerprint',
      'sha',
      'state',
    ]);
  });

  it('issue_opened', () => {
    const p = forgePacket(PACKET_TYPES.ISSUE_OPENED, ctx, {
      issue_number: 12,
      url: 'http://localhost:3000/o/r/issues/12',
      state: 'open',
      title: 'Bug report',
      created: true,
    });
    expect(p.type).toBe('issue_opened');
    expect(bodyKeys(p)).toEqual(['created', 'issue_number', 'state', 'title', 'url']);
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

  it('forge_error with idempotency_scan metadata', () => {
    const p = forgeErrorPacket(ctx, {
      code: 'idempotency_scan_incomplete',
      message: 'scan cap hit',
      fields: {
        idempotency_scan: { pages: 50, max_pages: 50, page_size: 100 },
      },
    });
    expect(bodyKeys(p)).toEqual([
      'error_code',
      'error_message',
      'idempotency_scan',
    ]);
    expect(p.idempotency_scan).toEqual({ pages: 50, max_pages: 50, page_size: 100 });
  });

  it('cr_merged', () => {
    const p = forgePacket(
      PACKET_TYPES.CR_MERGED,
      ctx,
      buildCrMergedBody({
        prNumber: 7,
        expected: { baseSha: BASE, headSha: HEAD },
        before: {
          base_sha: BASE,
          head_sha: HEAD,
          forge_head_ref_sha: HEAD,
          blockers: [],
        },
        merge: { method: 'merge', commit_sha: 'dddddddddddddddddddddddddddddddddddddddd' },
        after: { state: 'merged', base_sha: BASE, head_sha: HEAD },
      }),
    );
    expect(p.type).toBe('cr_merged');
    expect(p.ok).toBe(true);
    expect(bodyKeys(p)).toEqual(['after', 'before', 'change_request', 'expected', 'merge']);
  });

  it('cr_merge_blocked', () => {
    const p = forgePacket(
      PACKET_TYPES.CR_MERGE_BLOCKED,
      ctx,
      buildCrMergeBlockedBody({
        prNumber: 7,
        expected: { baseSha: BASE, headSha: HEAD },
        before: { base_sha: BASE, head_sha: HEAD, forge_head_ref_sha: HEAD },
        blockers: ['head_ref_moved'],
      }),
      { code: 'merge_blocked', message: 'Merge blocked by preflight' },
    );
    expect(p.type).toBe('cr_merge_blocked');
    expect(p.ok).toBe(false);
    expect(bodyKeys(p)).toEqual([
      'before',
      'blockers',
      'change_request',
      'error_code',
      'error_message',
      'expected',
    ]);
  });
});
