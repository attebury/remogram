import { sanitizeField } from './caps.js';
import { mergeBlockersFromFacts } from './merge-blockers.js';
import { staleHeadDetails } from './pr-head-reconcile.js';

export function buildHeadReconcile(ctx, view) {
  const details = staleHeadDetails(
    ctx.cwd,
    ctx.config?.remote ?? ctx.remoteName,
    view.head_ref,
    view.head_sha,
  );
  if (!details) return { stale: false };
  return {
    stale: true,
    local_head_sha: details.local_head_sha,
    head_sha: details.head_sha,
  };
}

/**
 * Compose one CR inventory entry from pr view and checks facts.
 */
export function buildCrInventoryEntry(ctx, view, checks) {
  const entry = {
    pr_number: view.pr_number,
    url: view.url,
    title: view.title,
    state: view.state,
    base_ref: view.base_ref,
    head_ref: view.head_ref,
    mergeability: view.mergeability,
    checks_conclusion: checks.check_conclusion,
    blockers: mergeBlockersFromFacts(view, checks),
    head_reconcile: buildHeadReconcile(ctx, view),
  };
  if (view.base_sha) entry.base_sha = view.base_sha;
  if (view.head_sha) entry.head_sha = view.head_sha;
  return entry;
}

/**
 * Aggregate open change requests into a semantic-diff-oriented inventory slice.
 * @param {object} ctx forge context
 * @param {object} provider must expose listOpenPulls, prView, prChecks
 * @param {{ slice_ref?: string }} [opts]
 */
export async function crInventory(ctx, provider, opts = {}) {
  const numbers = await provider.listOpenPulls(ctx);
  const entries = [];
  for (const number of numbers) {
    const view = await provider.prView(ctx, { number });
    if (view.state !== 'open') continue;
    const checks = await provider.prChecks(ctx, { number });
    entries.push(buildCrInventoryEntry(ctx, view, checks));
  }
  return {
    entries,
    ...(opts.slice_ref ? { slice_ref: sanitizeField(opts.slice_ref) } : {}),
  };
}
