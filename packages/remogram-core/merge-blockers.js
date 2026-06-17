import { allPathsAllowed, normalizeChangedPathList } from './path-allowlist.js';

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
export function mergeBlockersFromFacts(view, checks, pathScope = {}) {
  const blockers = [];
  if (view.mergeability === 'conflicted') blockers.push('merge_conflict');
  if (!isOpenPrState(view.state)) blockers.push('pr_not_open');
  if (checks.checks_truncated === true) blockers.push('checks_incomplete');
  if (checks.check_conclusion === 'failure') blockers.push('checks_failed');
  if (checks.check_conclusion === 'missing') blockers.push('checks_missing');
  if (checks.check_conclusion === 'pending') blockers.push('checks_pending');

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
