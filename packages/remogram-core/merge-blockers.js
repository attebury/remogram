/**
 * Derive merge blockers from already-fetched PR view and checks facts.
 * Shared by merge plan and cr inventory aggregation.
 */
export function isOpenPrState(state) {
  return String(state ?? '').toLowerCase() === 'open';
}

export function mergeBlockersFromFacts(view, checks) {
  const blockers = [];
  if (view.mergeability === 'conflicted') blockers.push('merge_conflict');
  if (!isOpenPrState(view.state)) blockers.push('pr_not_open');
  if (checks.check_conclusion === 'failure') blockers.push('checks_failed');
  if (checks.check_conclusion === 'missing') blockers.push('checks_missing');
  if (checks.check_conclusion === 'pending') blockers.push('checks_pending');
  return blockers;
}
