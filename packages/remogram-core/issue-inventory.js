import { sanitizeField } from './caps.js';
import { ERROR_CODES, forgeError } from './contracts/errors.js';
import {
  decodeIssueInventoryCursor,
  encodeIssueInventoryCursor,
} from './issue-inventory-cursor.js';
import {
  DEFAULT_CR_INVENTORY_SLICE_SORT,
  normalizeCrInventorySort,
} from './open-pull-list.js';

export const DEFAULT_ISSUE_INVENTORY_LIMIT = 50;
/** Default bound when `--limit` is omitted (keeps forge ingest under cap on large repos). */
export const DEFAULT_ISSUE_INVENTORY_SAFE_LIMIT = 3;

export function normalizeIssueInventoryLimit(value) {
  if (value == null || value === '') return DEFAULT_ISSUE_INVENTORY_SAFE_LIMIT;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw Object.assign(new Error('Invalid issue inventory limit'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--limit must be a positive integer'),
    });
  }
  return n;
}

async function resolveOpenIssueList(provider, ctx, listWindow, sliceSort) {
  if (typeof provider.listIssuesWithMeta === 'function') {
    return provider.listIssuesWithMeta(ctx, { retain_max: listWindow, sort: sliceSort });
  }
  const numbers = await provider.listIssues(ctx, {});
  return { numbers, list_truncated: false };
}

function skipErrorCode(err) {
  if (err?.forgeError?.code) return err.forgeError.code;
  return ERROR_CODES.API_ERROR;
}

export function buildIssueInventoryEntry(view) {
  const entry = {
    issue_number: view.issue_number,
    url: view.url,
    title: view.title,
    state: view.state,
  };
  if (view.linked_change_request) {
    entry.linked_change_request = view.linked_change_request;
  }
  return entry;
}

/**
 * Aggregate open issues into a semantic-diff-oriented inventory slice.
 * @param {object} ctx forge context
 * @param {object} provider must expose listIssues/listIssuesWithMeta and issueView
 * @param {{ slice_ref?: string, limit?: number, sort?: string, cursor?: string }} [opts]
 */
export async function issueInventory(ctx, provider, opts = {}) {
  const limit = normalizeIssueInventoryLimit(opts.limit);
  let sliceSort = normalizeCrInventorySort(opts.sort);
  let offset = 0;
  if (opts.cursor != null && opts.cursor !== '') {
    const decoded = decodeIssueInventoryCursor(opts.cursor, { sort: opts.sort });
    offset = decoded.offset;
    sliceSort = decoded.sort;
  }

  const listWindow = offset + limit;
  const {
    numbers,
    list_truncated: listTruncated,
    entry_count: providerEntryCount,
  } = await resolveOpenIssueList(provider, ctx, listWindow, sliceSort);
  const entryCount = providerEntryCount ?? numbers.length;
  const selected = numbers.slice(offset, offset + limit);
  const entries = [];
  const entries_skipped = [];
  for (const number of selected) {
    try {
      const view = await provider.issueView(ctx, { number });
      entries.push(buildIssueInventoryEntry(view));
    } catch (err) {
      entries_skipped.push({
        issue_number: number,
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
    ...(hasMore
      ? { next_cursor: encodeIssueInventoryCursor({ sort: sliceSort, offset: observedEnd }) }
      : {}),
    ...(opts.slice_ref ? { slice_ref: sanitizeField(opts.slice_ref) } : {}),
  };
}
