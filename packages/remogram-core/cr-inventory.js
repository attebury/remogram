import { sanitizeField } from './caps.js';
import { ERROR_CODES, forgeError } from './contracts/errors.js';
import { mergeBlockersFromFacts, isOpenPrState } from './merge-blockers.js';
import { staleHeadDetails } from './pr-head-reconcile.js';

export const DEFAULT_CR_INVENTORY_LIMIT = 50;

export function normalizeCrInventoryLimit(value) {
  if (value == null || value === '') return DEFAULT_CR_INVENTORY_LIMIT;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw Object.assign(new Error('Invalid cr inventory limit'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--limit must be a positive integer'),
    });
  }
  return n;
}

async function resolveOpenPullList(provider, ctx, limit) {
  const listOpts = { limit };
  if (typeof provider.listOpenPullsWithMeta === 'function') {
    return provider.listOpenPullsWithMeta(ctx, listOpts);
  }
  const numbers = await provider.listOpenPulls(ctx, listOpts);
  return { numbers, list_truncated: false };
}

function skipErrorCode(err) {
  if (err?.forgeError?.code) return err.forgeError.code;
  return ERROR_CODES.API_ERROR;
}

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
    checks_truncated: checks.checks_truncated === true,
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
 * @param {{ slice_ref?: string, limit?: number }} [opts]
 */
export async function crInventory(ctx, provider, opts = {}) {
  const limit = normalizeCrInventoryLimit(opts.limit);
  const { numbers, list_truncated: listTruncated } = await resolveOpenPullList(
    provider,
    ctx,
    limit,
  );
  const entryCount = numbers.length;
  const selected = numbers.slice(0, limit);
  const entries = [];
  const entries_skipped = [];
  for (const number of selected) {
    try {
      const view = await provider.prView(ctx, { number });
      if (!isOpenPrState(view.state)) {
        entries_skipped.push({ pr_number: number, error_code: ERROR_CODES.PR_NOT_OPEN });
        continue;
      }
      const checks = await provider.prChecks(ctx, { number });
      entries.push(buildCrInventoryEntry(ctx, view, checks));
    } catch (err) {
      entries_skipped.push({
        pr_number: number,
        error_code: skipErrorCode(err),
      });
    }
  }
  return {
    entries,
    ...(entries_skipped.length ? { entries_skipped } : {}),
    entry_count: entryCount,
    truncated: entryCount > selected.length,
    list_truncated: listTruncated,
    ...(opts.slice_ref ? { slice_ref: sanitizeField(opts.slice_ref) } : {}),
  };
}
