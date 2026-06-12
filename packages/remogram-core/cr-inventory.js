import { sanitizeField } from './caps.js';
import { mergeBlockersFromFacts } from './merge-blockers.js';

/**
 * Compose one CR inventory entry from pr view and checks facts.
 */
export function buildCrInventoryEntry(view, checks) {
  return {
    pr_number: view.pr_number,
    url: view.url,
    title: view.title,
    state: view.state,
    base_ref: view.base_ref,
    head_ref: view.head_ref,
    mergeability: view.mergeability,
    checks_conclusion: checks.check_conclusion,
    blockers: mergeBlockersFromFacts(view, checks),
  };
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
    entries.push(buildCrInventoryEntry(view, checks));
  }
  return {
    entries,
    ...(opts.slice_ref ? { slice_ref: sanitizeField(opts.slice_ref) } : {}),
  };
}
