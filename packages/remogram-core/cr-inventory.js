import { sanitizeField } from './caps.js';

/**
 * Compose one CR inventory entry from existing pr view, checks, and merge plan facts.
 */
export function buildCrInventoryEntry(view, checks, mergePlan) {
  return {
    pr_number: view.pr_number,
    url: view.url,
    title: view.title,
    state: view.state,
    base_ref: view.base_ref,
    head_ref: view.head_ref,
    mergeability: view.mergeability,
    checks_conclusion: checks.check_conclusion,
    blockers: mergePlan.blockers,
  };
}

/**
 * Aggregate open change requests into a semantic-diff-oriented inventory slice.
 * @param {object} ctx forge context
 * @param {object} provider must expose listOpenPulls, prView, prChecks, mergePlan
 * @param {{ slice_ref?: string }} [opts]
 */
export async function crInventory(ctx, provider, opts = {}) {
  const numbers = await provider.listOpenPulls(ctx);
  const entries = [];
  for (const number of numbers) {
    const view = await provider.prView(ctx, { number });
    if (view.state !== 'open') continue;
    const checks = await provider.prChecks(ctx, { number });
    const plan = await provider.mergePlan(ctx, { number });
    entries.push(buildCrInventoryEntry(view, checks, plan));
  }
  return {
    entries,
    ...(opts.slice_ref ? { slice_ref: sanitizeField(opts.slice_ref) } : {}),
  };
}
