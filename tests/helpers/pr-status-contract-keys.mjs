/** Canonical pr_status body keys — single source for packet-contracts and provider matrix tests. */
export const PR_STATUS_BODY_KEYS = [
  'forge_source_branch_ref',
  'forge_source_sha',
  'forge_target_branch_ref',
  'forge_target_sha',
  'mergeability',
  'pr_number',
  'state',
  'title',
  'url',
];

export const PR_STATUS_OPTIONAL_BODY_KEYS = ['forge_source_repo_id'];
