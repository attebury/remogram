import { allPathsAllowed, normalizeChangedPathList } from './path-allowlist.js';

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function diagnosticBlockers(checks) {
  const blockers = [];
  const missing = checks.missing_required_contexts;
  if (Array.isArray(missing) && missing.length > 0) blockers.push('required_checks_missing');
  const stale = checks.stale_contexts;
  if (Array.isArray(stale) && stale.length > 0) blockers.push('stale_status_context');
  const required = new Set(
    Array.isArray(checks.required_contexts) ? checks.required_contexts.filter(Boolean) : [],
  );
  if (required.size > 0 && Array.isArray(checks.pending_contexts)) {
    const pendingRequired = checks.pending_contexts.filter((context) => required.has(context));
    if (pendingRequired.length > 0) blockers.push('required_checks_pending');
  }
  return uniqueSorted(blockers);
}

/**
 * Derive merge blockers from already-fetched PR view and checks facts.
 * Shared by merge plan and cr inventory aggregation.
 */
export function isOpenPrState(state) {
  return String(state ?? '').toLowerCase() === 'open';
}

/**
 * @param {object} view
 * @param {object} checks
 * @param {{ allowed_paths?: string[], changed_paths?: string[] | null }} [pathScope]
 */
export function mergeBlockersFromFacts(view, checks, pathScope = {}, policy = {}) {
  const blockers = [];
  if (view.mergeability === 'conflicted') blockers.push('merge_conflict');
  if (!isOpenPrState(view.state)) blockers.push('pr_not_open');
  if (checks.checks_truncated === true) blockers.push('checks_incomplete');
  if (checks.check_conclusion === 'failure') blockers.push('checks_failed');
  if (checks.check_conclusion === 'missing' && !policy.allow_missing_checks) {
    blockers.push('checks_missing');
  }
  if (checks.check_conclusion === 'pending' && !policy.allow_pending_checks) {
    blockers.push('checks_pending');
  }
  blockers.push(...diagnosticBlockers(checks));

  const allowedPaths = pathScope.allowed_paths;
  if (Array.isArray(allowedPaths) && allowedPaths.length > 0) {
    const changedPaths = pathScope.changed_paths;
    if (changedPaths == null) {
      blockers.push('changed_paths_unavailable');
    } else if (Array.isArray(changedPaths)) {
      const normalizedPaths = normalizeChangedPathList(changedPaths);
      if (normalizedPaths == null) {
        blockers.push('changed_paths_unavailable');
      } else if (!allPathsAllowed(allowedPaths, normalizedPaths)) {
        blockers.push('path_scope_violation');
      }
    } else {
      blockers.push('changed_paths_unavailable');
    }
  }

  return blockers;
}
