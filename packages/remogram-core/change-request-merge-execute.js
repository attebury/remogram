import { sanitizeField } from './caps.js';
import { mergeBlockersFromFacts } from './merge-blockers.js';
import { mergePolicyAuditFacts } from './merge-policy.js';

const SHA40 = /^[0-9a-f]{40}$/i;
const MAX_RECOVERY_COMMANDS = 3;

export function mergeExecuteViewFacts(view) {
  return {
    sourceBranchRef: view.forge_source_branch_ref ?? view.head_ref ?? null,
    sourceSha: view.forge_source_sha ?? view.head_sha ?? null,
    targetBranchRef: view.forge_target_branch_ref ?? view.base_ref ?? null,
    targetSha: view.forge_target_sha ?? view.base_sha ?? null,
  };
}

export function mergeExecuteChecksFacts(checks) {
  return {
    sourceSha: checks.forge_source_sha ?? checks.head_sha ?? null,
  };
}

export function assertExpectedSha(value, flagName) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!SHA40.test(normalized)) {
    throw Object.assign(new Error(`Invalid ${flagName}`), {
      invalidArgs: `${flagName} must be a 40-character git SHA`,
    });
  }
  return normalized;
}

export function buildMergeExecuteBeforeFacts(
  view,
  checks,
  mergePlanBody,
  forgeHeadRefSha = null,
  mergePolicy = null,
) {
  const viewFacts = mergeExecuteViewFacts(view);
  const checksFacts = mergeExecuteChecksFacts(checks);
  const audit = mergePolicyAuditFacts(mergePolicy);
  return {
    base_sha: viewFacts.targetSha ?? null,
    head_sha: viewFacts.sourceSha ?? null,
    checks_head_sha: checksFacts.sourceSha ?? null,
    forge_head_ref_sha: forgeHeadRefSha ?? null,
    mergeability: view.mergeability ?? 'unknown',
    checks_conclusion: checks.check_conclusion ?? 'unknown',
    checks_truncated: checks.checks_truncated === true,
    merge_plan_blockers: Array.isArray(mergePlanBody.blockers) ? [...mergePlanBody.blockers] : [],
    ...(audit ? { merge_policy: audit } : {}),
  };
}

/**
 * Collect merge-execute blockers before forge mutation.
 * @returns {string[]} normalized blocker ids
 */
export function collectMergeExecuteBlockers(
  view,
  checks,
  mergePlanBody,
  expected,
  { forgeHeadRefSha, mergePolicy = {} } = {},
) {
  const viewFacts = mergeExecuteViewFacts(view);
  const checksFacts = mergeExecuteChecksFacts(checks);
  const blockers = [];
  const baseSha = viewFacts.targetSha ? String(viewFacts.targetSha).toLowerCase() : null;
  const headSha = viewFacts.sourceSha ? String(viewFacts.sourceSha).toLowerCase() : null;

  if (baseSha && expected.baseSha !== baseSha) blockers.push('base_sha_mismatch');
  if (headSha && expected.headSha !== headSha) blockers.push('head_sha_mismatch');

  const forgeHead = forgeHeadRefSha ? String(forgeHeadRefSha).toLowerCase() : null;
  const checksHead = checksFacts.sourceSha ? String(checksFacts.sourceSha).toLowerCase() : null;
  if (headSha && checksHead && headSha !== checksHead) blockers.push('checks_head_sha_mismatch');
  if (headSha && forgeHead && headSha !== forgeHead) blockers.push('forge_pr_head_mismatch');
  if (checksHead && forgeHead && checksHead !== forgeHead) blockers.push('checks_forge_head_mismatch');
  if (forgeHead && forgeHead !== expected.headSha) blockers.push('head_ref_moved');

  const planBlockers = mergeBlockersFromFacts(view, checks, {}, mergePolicy);
  for (const blocker of planBlockers) {
    if (!blockers.includes(blocker)) blockers.push(blocker);
  }

  if (view.mergeability !== 'clean') {
    if (view.mergeability === 'conflicted' && !blockers.includes('merge_conflict')) {
      blockers.push('merge_conflict');
    } else if (view.mergeability !== 'conflicted' && !blockers.includes('mergeability_not_clean')) {
      blockers.push('mergeability_not_clean');
    }
  }

  return blockers;
}

export function buildCrMergeBlockedBody({
  prNumber,
  expected,
  before,
  blockers,
}) {
  return {
    change_request: { number: prNumber },
    expected: {
      base_sha: expected.baseSha,
      head_sha: expected.headSha,
    },
    before,
    blockers,
  };
}

export function buildCrMergedBody({
  prNumber,
  expected,
  before,
  merge,
  after,
}) {
  return {
    change_request: { number: prNumber, state: 'merged' },
    expected: {
      base_sha: expected.baseSha,
      head_sha: expected.headSha,
    },
    before,
    merge,
    after,
  };
}

export function buildMergeExecuteAfterFacts(view, mergeResult = {}) {
  const viewFacts = mergeExecuteViewFacts(view);
  const readback = mergeResult.post_merge_readback ?? null;
  const providerBaseSha = mergeResult.base_sha ?? null;
  const base_sha = providerBaseSha ?? null;
  return {
    state: 'merged',
    base_sha,
    head_sha: viewFacts.sourceSha ?? null,
    ...(readback ? { post_merge_readback: readback } : {}),
  };
}

export function buildMergeExecuteMergeFacts(method, providerResult = {}) {
  return {
    method: sanitizeField(method),
    commit_sha: providerResult.commit_sha ?? null,
    provider_status: providerResult.provider_status ?? null,
    ...(providerResult.post_merge_readback
      ? { post_merge_readback: providerResult.post_merge_readback }
      : {}),
  };
}

export function mergeEndpointRecoveryHints(prNumber, expected) {
  const numberPart = Number.isInteger(Number(prNumber)) ? Number(prNumber) : '<n>';
  const headSha = expected?.headSha || '<head-sha>';
  const baseSha = expected?.baseSha || '<base-sha>';
  return {
    suggested_commands: [
      `remogram pr view --number ${numberPart} --json`,
      `remogram pr checks --number ${numberPart} --json`,
      `remogram merge execute --number ${numberPart} --expected-base-sha ${baseSha} --expected-head-sha ${headSha} --json`,
    ].slice(0, MAX_RECOVERY_COMMANDS),
  };
}
