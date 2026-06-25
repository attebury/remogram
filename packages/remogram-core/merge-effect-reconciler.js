const SHA40 = /^[0-9a-f]{40}$/i;

function normalizeSha(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  return SHA40.test(normalized) ? normalized : null;
}

/**
 * Classify merge POST failures using post-error forge reads.
 *
 * @param {{
 *   expectedHeadSha: string,
 *   expectedBaseSha: string,
 *   beforeBaseSha?: string | null,
 *   targetBranchSha?: string | null,
 *   prState?: string | null,
 *   mergeCommitSha?: string | null,
 * }} input
 */
export function reconcileMergeEffectAfterError(input) {
  const expectedHeadSha = normalizeSha(input.expectedHeadSha);
  const expectedBaseSha = normalizeSha(input.expectedBaseSha);
  const beforeBaseSha = normalizeSha(input.beforeBaseSha ?? expectedBaseSha);
  const targetBranchSha = normalizeSha(input.targetBranchSha);
  const prState = typeof input.prState === 'string' ? input.prState.toLowerCase() : '';
  const mergeCommitSha = normalizeSha(input.mergeCommitSha);

  const branchAdvanced =
    targetBranchSha != null
    && beforeBaseSha != null
    && targetBranchSha !== beforeBaseSha;
  const prMerged = prState === 'closed' || prState === 'merged' || mergeCommitSha != null;
  const effectSuspected = branchAdvanced || prMerged;

  let status = 'unchanged';
  if (effectSuspected) {
    status = branchAdvanced ? 'target_branch_advanced' : 'pr_state_terminal';
  }

  return {
    status,
    retry_safe: !effectSuspected,
    partial_success_suspected: effectSuspected,
    expected_head_sha: expectedHeadSha,
    expected_base_sha: expectedBaseSha,
    target_branch_sha: targetBranchSha,
    merge_commit_sha: mergeCommitSha,
    suggested_commands: [
      'remogram pr view --number <n> --json',
      'remogram refs compare --base <integration-ref> --head <integration-ref> --json',
      'remogram merge plan --number <n> --json',
    ],
  };
}

export function buildCrMergeIndeterminateBody({
  prNumber,
  expected,
  before,
  reconciliation,
  endpointError,
}) {
  return {
    change_request: { number: prNumber },
    expected: {
      base_sha: expected.baseSha,
      head_sha: expected.headSha,
    },
    before,
    post_error_reconciliation: reconciliation,
    endpoint_error: endpointError,
  };
}
