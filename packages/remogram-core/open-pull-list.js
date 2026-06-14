import { ERROR_CODES, forgeError } from './contracts/errors.js';

/** Normalized slice sort keys exposed on CLI/MCP and success packets. */
export const CR_INVENTORY_SLICE_SORTS = Object.freeze([
  'number_asc',
  'number_desc',
  'recent_update',
  'recent_created',
]);

export const DEFAULT_CR_INVENTORY_SLICE_SORT = 'number_asc';

/**
 * @param {unknown} value
 * @returns {typeof CR_INVENTORY_SLICE_SORTS[number]}
 */
export function normalizeCrInventorySort(value) {
  if (value == null || value === '') return DEFAULT_CR_INVENTORY_SLICE_SORT;
  const sort = String(value).trim().toLowerCase();
  if (!CR_INVENTORY_SLICE_SORTS.includes(sort)) {
    throw Object.assign(new Error('Invalid cr inventory sort'), {
      forgeError: forgeError(
        ERROR_CODES.INVALID_ARGS,
        `--sort must be one of: ${CR_INVENTORY_SLICE_SORTS.join(', ')}`,
      ),
    });
  }
  return sort;
}

/**
 * Parse forge total-count response header as a positive integer within sanity bounds.
 * @param {Headers | Record<string, string> | null | undefined} headers
 * @param {string} headerName
 * @param {{ maxTrusted: number }} opts
 * @returns {number | null}
 */
export function parseTotalCountHeader(headers, headerName, { maxTrusted }) {
  if (headers == null || maxTrusted <= 0) return null;
  const read =
    typeof headers.get === 'function'
      ? (name) => headers.get(name)
      : (name) => headers[name] ?? headers[String(name).toLowerCase()];
  const raw = read(headerName) ?? read(String(headerName).toLowerCase());
  if (raw == null || raw === '') return null;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n <= 0 || n > maxTrusted) return null;
  return n;
}

/**
 * Fast path applies to cr inventory retain_max slices, not idempotency scans.
 * @param {{ retain_max?: number | null, limit?: number | null }} opts
 */
export function isCrInventoryFastPathEligible(opts = {}) {
  return (
    opts.retain_max != null &&
    Number.isInteger(Number(opts.retain_max)) &&
    Number(opts.retain_max) > 0
  );
}

/**
 * When forge order is authoritative, skip client-side number reordering.
 * @param {string} sliceSort
 */
export function forgeOrderAuthoritative(sliceSort) {
  return sliceSort === 'recent_update' || sliceSort === 'recent_created';
}

/**
 * Fast path requires the first page to contain the expected item count.
 * @param {number} totalCount
 * @param {number} requestLimit
 * @param {number} bodyLength
 */
export function validateFastPathPageLength(totalCount, requestLimit, bodyLength) {
  const expected = Math.min(totalCount, requestLimit);
  return bodyLength === expected;
}

/**
 * Number sorts need full local reorder; skip fast path when total exceeds retain_max.
 * @param {number} totalCount
 * @param {number} retainMax
 * @param {string} sliceSort
 */
export function isNumberSortFastPathEligible(totalCount, retainMax, sliceSort) {
  if (sliceSort !== 'number_asc' && sliceSort !== 'number_desc') return true;
  return totalCount <= retainMax;
}

/**
 * Prefer forge header/search total over summed pagination lengths on fallback.
 * @param {number | null | undefined} trustedTotal
 * @param {number} summedCount
 */
export function resolvePaginatedEntryCount(trustedTotal, summedCount) {
  if (trustedTotal != null && Number.isInteger(trustedTotal) && trustedTotal > 0) {
    return trustedTotal;
  }
  return summedCount;
}

/**
 * When forge total is trusted but pagination walked fewer items, mark truncated.
 * @param {{ listTruncated: boolean, trustedTotalCount?: number | null, walkedCount: number, fullCollect?: boolean }} opts
 */
export function resolveListTruncatedWithTrustedTotal({
  listTruncated,
  trustedTotalCount,
  walkedCount,
  fullCollect = false,
}) {
  if (
    trustedTotalCount != null &&
    Number.isInteger(trustedTotalCount) &&
    trustedTotalCount > 0 &&
    walkedCount < trustedTotalCount
  ) {
    return true;
  }
  return listTruncated;
}

/**
 * Gitea recent_created uses oldest sort; fast path only when total fits retain_max.
 * @param {number} totalCount
 * @param {number} retainMax
 * @param {string} sliceSort
 * @param {string} providerId
 */
export function isRecentCreatedFastPathEligible(totalCount, retainMax, sliceSort, providerId) {
  if (sliceSort !== 'recent_created' || providerId !== 'gitea-api') return true;
  return totalCount <= retainMax;
}

/**
 * Last page index for Gitea sort=oldest when fetching globally newest-created slice.
 * @param {number} totalCount
 * @param {number} pageSize
 */
export function giteaRecentCreatedTailPage(totalCount, pageSize) {
  if (!Number.isInteger(totalCount) || totalCount <= 0) return 1;
  if (!Number.isInteger(pageSize) || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(totalCount / pageSize));
}

/**
 * Number sorts need full local reorder when total exceeds retain_max.
 * @param {number} totalCount
 * @param {number} retainMax
 * @param {string} sliceSort
 */
export function isNumberSortFullCollectRequired(totalCount, retainMax, sliceSort) {
  if (forgeOrderAuthoritative(sliceSort)) return false;
  return !isNumberSortFastPathEligible(totalCount, retainMax, sliceSort);
}

/**
 * Gitea sort=oldest returns oldest-first; recent_created needs newest-first.
 * @param {unknown[]} items
 * @param {string} sliceSort
 */
export function prepareGiteaOpenPullPageItems(items, sliceSort) {
  if (sliceSort !== 'recent_created' || !Array.isArray(items)) return items;
  return items.slice().reverse();
}

/**
 * @param {unknown[]} items
 * @param {(item: unknown) => number | null | undefined} getNumber
 * @param {string} sliceSort
 * @returns {number[]}
 */
export function orderOpenPullNumbers(items, getNumber, sliceSort) {
  const numbers = items
    .map(getNumber)
    .filter((number) => Number.isInteger(number));
  if (forgeOrderAuthoritative(sliceSort)) return numbers;
  numbers.sort((a, b) => (sliceSort === 'number_desc' ? b - a : a - b));
  return numbers;
}

/**
 * @param {{ totalCount?: number | null, numbers: number[], listTruncated: boolean, sliceSort?: string }} meta
 */
export function buildOpenPullListMeta({ totalCount, numbers, listTruncated, sliceSort }) {
  return {
    numbers,
    list_truncated: listTruncated,
    ...(totalCount != null ? { entry_count: totalCount } : {}),
    ...(sliceSort ? { slice_sort: sliceSort } : {}),
  };
}

/**
 * Gitea query params for normalized slice sort.
 * @param {string} sliceSort
 */
export function giteaOpenPullSortQuery(sliceSort) {
  switch (sliceSort) {
    case 'recent_update':
      return { sort: 'recentupdate' };
    case 'recent_created':
      return { sort: 'oldest' };
    default:
      return {};
  }
}

/**
 * GitLab query params for normalized slice sort.
 * @param {string} sliceSort
 */
export function gitlabOpenPullSortQuery(sliceSort) {
  switch (sliceSort) {
    case 'recent_update':
      return { order_by: 'updated_at', sort: 'desc' };
    case 'recent_created':
      return { order_by: 'created_at', sort: 'desc' };
    case 'number_desc':
      return { order_by: 'created_at', sort: 'desc' };
    default:
      return { order_by: 'created_at', sort: 'asc' };
  }
}

/**
 * GitHub query params for normalized slice sort on list pulls.
 * @param {string} sliceSort
 */
export function githubOpenPullSortQuery(sliceSort) {
  switch (sliceSort) {
    case 'recent_update':
      return { sort: 'updated', direction: 'desc' };
    case 'recent_created':
      return { sort: 'created', direction: 'desc' };
    case 'number_desc':
      return { sort: 'created', direction: 'desc' };
    default:
      return { sort: 'created', direction: 'asc' };
  }
}

/**
 * Append URLSearchParams for forge sort query entries.
 * @param {string} path
 * @param {Record<string, string>} query
 */
export function appendSortQuery(path, query) {
  if (!query || Object.keys(query).length === 0) return path;
  const sep = path.includes('?') ? '&' : '?';
  const params = new URLSearchParams(query);
  return `${path}${sep}${params.toString()}`;
}
