import { ERROR_CODES } from './contracts/errors.js';
import { DEFAULT_CHECK_STATUS_PAGE_SIZE, MAX_CHECK_STATUS_PAGES } from './caps.js';
import { resolvePaginatedEntryCount } from './open-pull-list.js';

function isOversizedIngestError(err) {
  return err?.forgeError?.code === ERROR_CODES.OVERSIZED_RAW_OUTPUT;
}

export function withPerPageParam(url, limit) {
  const parsed = new URL(url);
  parsed.searchParams.set('per_page', String(limit));
  return parsed.toString();
}

export function withLimitParam(url, limit) {
  const parsed = new URL(url);
  parsed.searchParams.set('limit', String(limit));
  return parsed.toString();
}

/**
 * Retry fetch with halved page size when raw ingest exceeds cap.
 * @template T
 * @param {(url: string) => Promise<T>} fetchFn
 * @param {(limit: number) => string} buildUrl
 * @param {number} [initialLimit]
 */
export async function fetchWithIngestPageBackoff(
  fetchFn,
  buildUrl,
  initialLimit = DEFAULT_CHECK_STATUS_PAGE_SIZE,
) {
  let limit = initialLimit;
  while (true) {
    try {
      return await fetchFn(buildUrl(limit));
    } catch (err) {
      if (isOversizedIngestError(err) && limit > 1) {
        limit = Math.max(1, Math.floor(limit / 2));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Fetch one offset page with ingest-cap backoff.
 * @template T
 * @param {(opts: { page: number, limit: number }) => Promise<unknown[]>} fetchPage
 * @param {number} page
 * @param {number} initialLimit
 * @returns {Promise<{ items: unknown[], usedLimit: number }>}
 */
export async function fetchPageWithIngestBackoff(fetchPage, page, initialLimit) {
  let usedLimit = initialLimit;
  const items = await fetchWithIngestPageBackoff(
    async (limit) => {
      usedLimit = limit;
      const pageItems = await fetchPage({ page, limit });
      return Array.isArray(pageItems) ? pageItems : [];
    },
    (limit) => limit,
    initialLimit,
  );
  return { items, usedLimit };
}

/**
 * When a full page lands on maxPages, probe one item on the next page to distinguish
 * end-of-list from truncation.
 * @template T
 * @param {(opts: { page: number, limit: number }) => Promise<unknown[]>} fetchPage
 * @param {number} page
 * @param {number} maxPages
 * @returns {Promise<boolean>} true when list is truncated (more items exist)
 */
async function probeNextPageHasItems(fetchPage, page, maxPages) {
  if (page > maxPages) return true;
  const { items: probeItems } = await fetchPageWithIngestBackoff(fetchPage, page + 1, 1);
  return probeItems.length > 0;
}

/**
 * Offset/limit check-status pagination with ingest-cap backoff.
 * @param {{ fetchPage: (opts: { page: number, limit: number }) => Promise<unknown[]>, pageSize?: number, maxPages?: number }} opts
 */
export async function paginateCheckStatusPages({
  fetchPage,
  pageSize = DEFAULT_CHECK_STATUS_PAGE_SIZE,
  maxPages = MAX_CHECK_STATUS_PAGES,
}) {
  const all = [];
  let truncated = false;
  let activeLimit = pageSize;
  for (let page = 1; page <= maxPages; page += 1) {
    const { items: pageItems, usedLimit } = await fetchPageWithIngestBackoff(
      fetchPage,
      page,
      activeLimit,
    );
    activeLimit = usedLimit;
    all.push(...pageItems);
    if (pageItems.length < usedLimit) {
      break;
    }
    if (page === maxPages) {
      truncated = true;
      break;
    }
  }
  return { items: all, truncated };
}

/**
 * Offset/limit open-list pagination with ingest-cap backoff and optional list cap.
 * listLimit bounds request size per page; callers slice returned items when enforcing a hard cap.
 * @param {{ fetchPage: (opts: { page: number, limit: number }) => Promise<unknown[]>, pageSize: number, listLimit?: number | null, maxPages?: number, maxPagesTruncatesWithLimit?: boolean, retainMax?: number | null, trustedEntryCount?: number | null, seededFirstPage?: { items: unknown[], usedLimit: number } | null, startPage?: number, suppressFinalPageProbe?: boolean }} opts
 * @returns {Promise<{ items: unknown[], list_truncated: boolean, walked_count: number, entry_count?: number }>}
 */
export async function paginateOffsetListPages({
  fetchPage,
  pageSize,
  listLimit = null,
  maxPages = MAX_CHECK_STATUS_PAGES,
  maxPagesTruncatesWithLimit = false,
  retainMax = null,
  trustedEntryCount = null,
  seededFirstPage = null,
  startPage = 1,
  suppressFinalPageProbe = false,
}) {
  const all = [];
  let entryCount = 0;
  let listTruncated = false;
  let activeLimit = pageSize;

  async function afterPage(page, items, usedLimit) {
    entryCount += items.length;
    if (retainMax != null) {
      const space = Math.max(retainMax - all.length, 0);
      if (space > 0) all.push(...items.slice(0, space));
    } else {
      all.push(...items);
    }
    if (items.length < usedLimit) {
      if (
        trustedEntryCount != null &&
        trustedEntryCount > entryCount &&
        page === 1 &&
        page < maxPages
      ) {
        return false;
      }
      return true;
    }
    if (listLimit != null && all.length >= listLimit) {
      listTruncated = await probeNextPageHasItems(fetchPage, page, maxPages);
      return true;
    }
    if (listLimit != null) {
      if (maxPagesTruncatesWithLimit && page === maxPages) {
        listTruncated = true;
        return true;
      }
    } else if (page === maxPages) {
      if (suppressFinalPageProbe) {
        listTruncated = items.length >= usedLimit;
      } else {
        listTruncated = await probeNextPageHasItems(fetchPage, page, maxPages);
      }
      return true;
    }
    return false;
  }

  let page = startPage;
  if (seededFirstPage && startPage === 1) {
    const { items, usedLimit } = seededFirstPage;
    activeLimit = usedLimit;
    if (await afterPage(1, items, usedLimit)) {
      return {
        items: all,
        list_truncated: listTruncated,
        walked_count: entryCount,
        ...(retainMax != null || trustedEntryCount != null
          ? { entry_count: resolvePaginatedEntryCount(trustedEntryCount, entryCount) }
          : {}),
      };
    }
    page = 2;
    activeLimit = pageSize;
  }

  for (; page <= maxPages; page += 1) {
    const remaining = listLimit != null ? Math.max(listLimit - all.length, 0) : activeLimit;
    if (listLimit != null && remaining === 0) break;
    const requestLimit = listLimit != null ? Math.min(activeLimit, remaining) : activeLimit;
    const { items, usedLimit } = await fetchPageWithIngestBackoff(fetchPage, page, requestLimit);
    activeLimit = usedLimit;
    if (await afterPage(page, items, usedLimit)) {
      break;
    }
  }

  return {
    items: all,
    list_truncated: listTruncated,
    walked_count: entryCount,
    ...(retainMax != null || trustedEntryCount != null
      ? {
          entry_count: resolvePaginatedEntryCount(trustedEntryCount, entryCount),
        }
      : {}),
  };
}
