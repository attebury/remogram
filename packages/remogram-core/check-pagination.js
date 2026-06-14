import { ERROR_CODES } from './contracts/errors.js';
import { DEFAULT_CHECK_STATUS_PAGE_SIZE, MAX_CHECK_STATUS_PAGES } from './caps.js';

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
 * Offset/limit check-status pagination with ingest-cap backoff.
 * @param {{ fetchPage: (opts: { page: number, limit: number }) => Promise<unknown[]>, pageSize?: number, maxPages?: number }} opts
 */
export async function paginateCheckStatusPages({
  fetchPage,
  pageSize = DEFAULT_CHECK_STATUS_PAGE_SIZE,
  maxPages = MAX_CHECK_STATUS_PAGES,
}) {
  const all = [];
  for (let page = 1; page <= maxPages; page += 1) {
    let limit = pageSize;
    let pageItems;
    while (true) {
      try {
        const items = await fetchPage({ page, limit });
        pageItems = Array.isArray(items) ? items : [];
        break;
      } catch (err) {
        if (isOversizedIngestError(err) && limit > 1) {
          limit = Math.max(1, Math.floor(limit / 2));
          continue;
        }
        throw err;
      }
    }
    all.push(...pageItems);
    if (pageItems.length < limit) break;
  }
  return all;
}
