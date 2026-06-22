import { parseStatusSetArgs } from '@remogram/core';

export function createMockProvider(overrides = {}) {
  return {
    id: 'gitea-api',
    providerCapabilities: async () => ({
      commands: [
        { name: 'repo_status', implemented: true },
        { name: 'ref_compare', implemented: true },
        { name: 'ref_inventory', implemented: true },
        { name: 'cr_inventory', implemented: true },
        { name: 'pr_status', implemented: true },
        { name: 'pr_checks', implemented: true },
        { name: 'merge_plan', implemented: true },
        { name: 'sync_plan', implemented: true },
        { name: 'whoami', implemented: true, auth_class: 'token_required' },
        { name: 'branch_protection', implemented: true, auth_class: 'token_required' },
        { name: 'cr_files', implemented: true, auth_class: 'token_required' },
        { name: 'cr_comments', implemented: true, auth_class: 'token_required' },
        { name: 'forge_changes', implemented: true, auth_class: 'token_required' },
        { name: 'cr_open', implemented: true, auth_class: 'token_required' },
        { name: 'status_set', implemented: true, auth_class: 'token_required' },
        { name: 'merge_execute', implemented: true, auth_class: 'token_required' },
      ],
      auth_envs: ['GITEA_TOKEN'],
      check_sources: ['commit_statuses'],
      mergeability_confidence: 'direct',
      host_binding: 'trusted_base_url',
      pagination: 'first_page_only',
      write_support: true,
      write_commands: ['cr_open', 'status_set', 'merge', 'issue_open'],
      forge_ingest_cap_bytes: 8192,
    }),
    repoStatus: async () => ({
      auth_present: true,
      auth_env: 'GITEA_TOKEN',
      capabilities: ['repo_status', 'ref_compare', 'ref_inventory', 'cr_inventory', 'pr_status', 'pr_checks', 'merge_plan', 'sync_plan', 'whoami', 'branch_protection', 'cr_files', 'cr_comments', 'forge_changes', 'cr_open', 'status_set'],
      default_branch: 'main',
    }),
    refsCompare: async (_ctx, base, head) => ({
      compare_base_ref: base,
      compare_base_sha: 'aaa111',
      compare_head_ref: head,
      compare_head_sha: 'bbb222',
      ahead_by: 1,
      behind_by: 0,
    }),
    refsInventory: async () => ({
      refs: [{ name: 'main', sha: 'aaa111', kind: 'branch', is_default: true }],
      default_ref: 'main',
    }),
    listOpenPulls: async () => [1, 2],
    crInventory: async (_ctx, opts = {}) => ({
      entries: [
        {
          pr_number: 1,
          url: 'http://localhost:3000/o/r/pulls/1',
          title: 'Test PR',
          state: 'open',
          forge_target_branch_ref: 'main',
          forge_source_branch_ref: 'feat',
          forge_target_sha: 'aaa111',
          forge_source_sha: 'bbb222',
          mergeability: 'clean',
          checks_conclusion: 'success',
          checks_truncated: false,
          blockers: [],
          head_reconcile: { stale: false },
        },
      ],
      entry_count: 1,
      truncated: false,
      list_truncated: false,
      ...(opts.slice_ref ? { slice_ref: opts.slice_ref } : {}),
    }),
    prView: async (_ctx, { number }) => ({
      pr_number: number,
      url: 'http://localhost:3000/o/r/pulls/1',
      title: 'Test PR',
      state: 'open',
      forge_target_branch_ref: 'main',
      forge_target_sha: 'aaa111',
      forge_source_branch_ref: 'feat',
      forge_source_sha: 'bbb222',
      mergeability: 'clean',
    }),
    prChecks: async () => ({
      forge_source_sha: 'bbb222',
      check_conclusion: 'success',
      checks_truncated: false,
      statuses: [{ context: 'ci/gate', state: 'success', description: 'ok' }],
    }),
    mergePlan: async (_ctx, { number }) => ({
      pr_number: number,
      mergeability: 'clean',
      checks_conclusion: 'success',
      blockers: [],
    }),
    syncPlan: async (_ctx, remote) => ({
      remote,
      local_sha: 'localsha',
      remote_sha: 'localsha',
      diverged: false,
      blockers: [],
    }),
    crOpen: async (_ctx, { head, base, title }) => ({
      pr_number: 99,
      url: 'http://localhost:3000/o/r/pulls/99',
      head,
      base,
      title,
    }),
    statusSet: async (_ctx, args) => {
      const { idempotencyFingerprint, ...rest } = args;
      const parsed = parseStatusSetArgs(rest);
      return {
        sha: parsed.sha,
        context: parsed.context,
        state: parsed.state,
        created: true,
        ...(parsed.description ? { description: parsed.description } : {}),
        ...(parsed.target_url ? { target_url: parsed.target_url } : {}),
        ...(idempotencyFingerprint ? { idempotency_fingerprint: idempotencyFingerprint } : {}),
      };
    },
    issueOpen: async (_ctx, { title, body, idempotencyFingerprint = null }) => ({
      issue_number: 55,
      url: 'http://localhost:3000/o/r/issues/55',
      state: 'open',
      title,
      created: true,
      ...(body ? {} : {}),
      ...(idempotencyFingerprint ? { idempotency_fingerprint: idempotencyFingerprint } : {}),
    }),
    whoami: async () => ({
      login: 'agent-user',
      can_write: true,
      token_scope_signal: { implemented: false, scopes: null },
      token_expiry_signal: { implemented: false, expires_at: null },
    }),
    branchProtection: async (_ctx, { branchRef }) => ({
      branch_ref: branchRef,
      required_status_contexts: ['ci/test'],
      protected_branch_rules: [{ name: branchRef }],
      approvals_required: { implemented: true, count: 1 },
    }),
    branchHeadSha: async (_ctx, branchRef, { repoId } = {}) => {
      void repoId;
      if (branchRef === 'missing-branch') {
        throw Object.assign(new Error('Branch not found'), {
          forgeError: { code: 'missing_ref', message: 'Branch not found' },
        });
      }
      return 'bbb222';
    },
    crFiles: async (_ctx, { number }) => ({
      pr_number: number,
      changed_paths: ['packages/remogram-core/foo.js'],
      paths_truncated: false,
      path_count: 1,
    }),
    crComments: async (_ctx, { number }) => ({
      pr_number: number,
      comments: [
        {
          id: '101',
          author: 'reviewer-bot',
          path: 'packages/remogram-core/foo.js',
          line: 10,
          body: 'Please fix this.',
          resolved: false,
        },
      ],
      comments_truncated: false,
      comment_count: 1,
    }),
    forgeChanges: async (_ctx, { since }) => ({
      since,
      since_kind: 'observed_at',
      events: [
        {
          kind: 'pr_opened',
          pr_number: 7,
          title: 'Test PR',
          url: 'http://localhost:3000/o/r/pulls/7',
          state: 'open',
          opened_at: since,
        },
      ],
      events_truncated: false,
      event_count: 1,
    }),
    mergeExecute: async (_ctx, { number, expectedHeadSha: _expectedHeadSha }) => ({
      commit_sha: 'cccccccccccccccccccccccccccccccccccccccc',
      provider_status: 200,
    }),
    ...overrides,
  };
}

export function defaultTestConfig(overrides = {}) {
  return {
    version: '1',
    provider: 'gitea-api',
    owner: 'owner',
    repo: 'repo',
    baseUrl: 'http://localhost:3000',
    remote: 'origin',
    write_commands: ['cr_open', 'status_set', 'merge', 'issue_open'],
    ...overrides,
  };
}
