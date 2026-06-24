import { sanitizeField } from './caps.js';
import { ERROR_CODES, forgeError } from './contracts/errors.js';
import { decodeCrInventoryCursor, encodeCrInventoryCursor } from './cr-inventory-cursor.js';
import { mergeBlockersFromFacts, isOpenPrState } from './merge-blockers.js';
import {
  DEFAULT_CR_INVENTORY_SLICE_SORT,
  normalizeCrInventorySort,
} from './open-pull-list.js';
import { staleHeadDetails } from './pr-head-reconcile.js';

export const DEFAULT_CR_INVENTORY_LIMIT = 50;
/** Default bound when `--limit` is omitted (keeps forge ingest under cap on large repos). */
export const DEFAULT_CR_INVENTORY_SAFE_LIMIT = 3;

export function normalizeCrInventoryLimit(value) {
  if (value == null || value === '') return DEFAULT_CR_INVENTORY_SAFE_LIMIT;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw Object.assign(new Error('Invalid cr inventory limit'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--limit must be a positive integer'),
    });
  }
  return n;
}

async function resolveOpenPullList(provider, ctx, listWindow, sliceSort) {
  if (typeof provider.listOpenPullsWithMeta === 'function') {
    return provider.listOpenPullsWithMeta(ctx, { retain_max: listWindow, sort: sliceSort });
  }
  const numbers = await provider.listOpenPulls(ctx, {});
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
    view.forge_source_branch_ref,
    view.forge_source_sha,
  );
  if (!details) return { stale: false };
  return {
    stale: true,
    local_head_sha: details.local_head_sha,
    forge_source_sha: details.forge_source_sha,
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
    forge_target_branch_ref: view.forge_target_branch_ref,
    forge_source_branch_ref: view.forge_source_branch_ref,
    mergeability: view.mergeability,
    checks_conclusion: checks.check_conclusion,
    checks_truncated: checks.checks_truncated === true,
    blockers: mergeBlockersFromFacts(view, checks, {}, ctx.mergePolicy ?? {}),
    head_reconcile: buildHeadReconcile(ctx, view),
  };
  if (view.forge_target_sha) entry.forge_target_sha = view.forge_target_sha;
  if (view.forge_source_sha) entry.forge_source_sha = view.forge_source_sha;
  return entry;
}

/**
 * Aggregate open change requests into a semantic-diff-oriented inventory slice.
 * @param {object} ctx forge context
 * @param {object} provider must expose listOpenPulls, prView, prChecks
 * @param {{ slice_ref?: string, limit?: number, sort?: string, cursor?: string }} [opts]
 */
export async function crInventory(ctx, provider, opts = {}) {
  const limit = normalizeCrInventoryLimit(opts.limit);
  let sliceSort = normalizeCrInventorySort(opts.sort);
  let offset = 0;
  if (opts.cursor != null && opts.cursor !== '') {
    const decoded = decodeCrInventoryCursor(opts.cursor, { sort: opts.sort });
    offset = decoded.offset;
    sliceSort = decoded.sort;
  }

  const listWindow = offset + limit;
  const {
    numbers,
    list_truncated: listTruncated,
    entry_count: providerEntryCount,
  } = await resolveOpenPullList(provider, ctx, listWindow, sliceSort);
  const entryCount = providerEntryCount ?? numbers.length;
  const selected = numbers.slice(offset, offset + limit);
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

  const observedEnd = offset + selected.length;
  const hasMore = listTruncated || observedEnd < entryCount;
  const complete = !hasMore;

  return {
    entries,
    ...(entries_skipped.length ? { entries_skipped } : {}),
    entry_count: entryCount,
    entry_count_observed: observedEnd,
    truncated: entryCount > observedEnd || listTruncated,
    list_truncated: listTruncated,
    slice_sort: sliceSort ?? DEFAULT_CR_INVENTORY_SLICE_SORT,
    has_more: hasMore,
    complete,
    ...(hasMore ? { next_cursor: encodeCrInventoryCursor({ sort: sliceSort, offset: observedEnd }) } : {}),
    ...(opts.slice_ref ? { slice_ref: sanitizeField(opts.slice_ref) } : {}),
  };
}
