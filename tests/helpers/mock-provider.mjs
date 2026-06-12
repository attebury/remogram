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
      ],
      auth_envs: ['GITEA_TOKEN'],
      check_sources: ['commit_statuses'],
      mergeability_confidence: 'direct',
      host_binding: 'trusted_base_url',
      pagination: 'first_page_only',
      write_support: false,
      forge_ingest_cap_bytes: 8192,
    }),
    repoStatus: async () => ({
      auth_present: true,
      auth_env: 'GITEA_TOKEN',
      capabilities: ['repo_status', 'ref_compare', 'ref_inventory', 'cr_inventory', 'pr_status', 'pr_checks', 'merge_plan', 'sync_plan'],
      default_branch: 'main',
    }),
    refsCompare: async (_ctx, base, head) => ({
      base_ref: base,
      base_sha: 'aaa111',
      head_ref: head,
      head_sha: 'bbb222',
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
          base_ref: 'main',
          head_ref: 'feat',
          base_sha: 'aaa111',
          head_sha: 'bbb222',
          mergeability: 'clean',
          checks_conclusion: 'success',
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
      base_ref: 'main',
      base_sha: 'aaa111',
      head_ref: 'feat',
      head_sha: 'bbb222',
      mergeability: 'clean',
    }),
    prChecks: async () => ({
      head_sha: 'bbb222',
      check_conclusion: 'success',
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
    ...overrides,
  };
}
