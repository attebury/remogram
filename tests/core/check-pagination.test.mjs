import { describe, it, expect } from 'vitest';
import {
  ERROR_CODES,
  paginateCheckStatusPages,
  paginateOffsetListPages,
  fetchWithIngestPageBackoff,
} from '@remogram/core';

describe('check pagination ingest backoff', () => {
  it('paginateCheckStatusPages halves limit on oversized ingest', async () => {
    const limits = [];
    const result = await paginateCheckStatusPages({
      pageSize: 8,
      fetchPage: async ({ limit }) => {
        limits.push(limit);
        if (limit > 4) {
          throw Object.assign(new Error('oversized'), {
            forgeError: { code: ERROR_CODES.OVERSIZED_RAW_OUTPUT },
          });
        }
        return [{ context: 'ci/ok', state: 'success' }];
      },
    });
    expect(limits).toEqual([8, 4]);
    expect(result.items).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });

  it('paginateCheckStatusPages carries reduced limit to page 2 after backoff', async () => {
    const requests = [];
    const result = await paginateCheckStatusPages({
      pageSize: 25,
      fetchPage: async ({ page, limit }) => {
        requests.push({ page, limit });
        if (page === 1 && limit > 12) {
          throw Object.assign(new Error('oversized'), {
            forgeError: { code: ERROR_CODES.OVERSIZED_RAW_OUTPUT },
          });
        }
        if (page === 1) {
          return Array.from({ length: 12 }, (_, i) => ({ context: `ci/${i}` }));
        }
        if (page === 2) {
          return [{ context: 'ci/last' }];
        }
        return [];
      },
    });
    expect(requests).toEqual([
      { page: 1, limit: 25 },
      { page: 1, limit: 12 },
      { page: 2, limit: 12 },
    ]);
    expect(result.items).toHaveLength(13);
    expect(result.truncated).toBe(false);
  });

  it('paginateCheckStatusPages sets truncated at maxPages with full last page', async () => {
    const result = await paginateCheckStatusPages({
      pageSize: 2,
      maxPages: 2,
      fetchPage: async () => [{ context: 'ci/a' }, { context: 'ci/b' }],
    });
    expect(result.items).toHaveLength(4);
    expect(result.truncated).toBe(true);
  });

  it('paginateCheckStatusPages does not truncate when last page is partial', async () => {
    const result = await paginateCheckStatusPages({
      pageSize: 3,
      maxPages: 5,
      fetchPage: async ({ page }) => (page === 1 ? [{ context: 'ci/one' }] : []),
    });
    expect(result.items).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });

  it('paginateCheckStatusPages throws when single item exceeds cap at minimum limit', async () => {
    await expect(
      paginateCheckStatusPages({
        pageSize: 1,
        maxPages: 1,
        fetchPage: async () => {
          throw Object.assign(new Error('oversized'), {
            forgeError: { code: ERROR_CODES.OVERSIZED_RAW_OUTPUT },
          });
        },
      }),
    ).rejects.toMatchObject({
      forgeError: { code: ERROR_CODES.OVERSIZED_RAW_OUTPUT },
    });
  });

  it('fetchWithIngestPageBackoff retries with smaller per_page', async () => {
    const limits = [];
    const result = await fetchWithIngestPageBackoff(
      async (url) => {
        const limit = Number(new URL(url).searchParams.get('per_page'));
        limits.push(limit);
        if (limit > 5) {
          throw Object.assign(new Error('oversized'), {
            forgeError: { code: ERROR_CODES.OVERSIZED_RAW_OUTPUT },
          });
        }
        return { ok: true };
      },
      (limit) => `https://example.test/statuses?per_page=${limit}`,
      10,
    );
    expect(result.ok).toBe(true);
    expect(limits).toEqual([10, 5]);
  });
});

describe('paginateOffsetListPages', () => {
  it('carries reduced limit to page 2 after backoff', async () => {
    const requests = [];
    const result = await paginateOffsetListPages({
      pageSize: 25,
      fetchPage: async ({ page, limit }) => {
        requests.push({ page, limit });
        if (page === 1 && limit > 12) {
          throw Object.assign(new Error('oversized'), {
            forgeError: { code: ERROR_CODES.OVERSIZED_RAW_OUTPUT },
          });
        }
        if (page === 1) {
          return Array.from({ length: 12 }, (_, i) => ({ number: i + 1 }));
        }
        if (page === 2) {
          return [{ number: 13 }];
        }
        return [];
      },
    });
    expect(requests).toEqual([
      { page: 1, limit: 25 },
      { page: 1, limit: 12 },
      { page: 2, limit: 12 },
    ]);
    expect(result.items).toHaveLength(13);
    expect(result.list_truncated).toBe(false);
  });

  it('honors listLimit and sets list_truncated when more pages exist', async () => {
    const result = await paginateOffsetListPages({
      pageSize: 1,
      listLimit: 1,
      fetchPage: async ({ page }) => (page === 1 ? [{ number: 1 }] : [{ number: 2 }]),
    });
    expect(result.items).toHaveLength(1);
    expect(result.list_truncated).toBe(true);
  });

  it('listLimit exact full page confirms end when next page is empty', async () => {
    const result = await paginateOffsetListPages({
      pageSize: 3,
      listLimit: 3,
      fetchPage: async ({ page }) => (page === 1 ? [{ number: 33 }, { number: 41 }, { number: 43 }] : []),
    });
    expect(result.items).toHaveLength(3);
    expect(result.list_truncated).toBe(false);
  });

  it('sets list_truncated at maxPages without listLimit when probe finds more', async () => {
    const result = await paginateOffsetListPages({
      pageSize: 1,
      maxPages: 2,
      fetchPage: async () => [{ number: 1 }],
    });
    expect(result.items).toHaveLength(2);
    expect(result.list_truncated).toBe(true);
  });

  it('listLimit null at maxPages with empty probe is complete', async () => {
    const result = await paginateOffsetListPages({
      pageSize: 2,
      maxPages: 2,
      fetchPage: async ({ page }) => {
        if (page === 1) return [{ number: 1 }, { number: 2 }];
        if (page === 2) return [{ number: 3 }, { number: 4 }];
        return [];
      },
    });
    expect(result.items).toHaveLength(4);
    expect(result.list_truncated).toBe(false);
  });

  it('listLimit null at maxPages with non-empty probe is truncated', async () => {
    const result = await paginateOffsetListPages({
      pageSize: 2,
      maxPages: 2,
      fetchPage: async ({ page }) => {
        if (page === 1) return [{ number: 1 }, { number: 2 }];
        if (page === 2) return [{ number: 3 }, { number: 4 }];
        return [{ number: 5 }];
      },
    });
    expect(result.items).toHaveLength(4);
    expect(result.list_truncated).toBe(true);
  });

  it('retainMax keeps slice while reporting full entry_count', async () => {
    const result = await paginateOffsetListPages({
      pageSize: 2,
      retainMax: 2,
      fetchPage: async ({ page }) => {
        if (page === 1) return [{ number: 1 }, { number: 2 }];
        if (page === 2) return [{ number: 3 }];
        return [];
      },
    });
    expect(result.items).toHaveLength(2);
    expect(result.entry_count).toBe(3);
    expect(result.list_truncated).toBe(false);
  });

  it('truncates at maxPages when listLimit set and maxPagesTruncatesWithLimit', async () => {
    const result = await paginateOffsetListPages({
      pageSize: 1,
      listLimit: 100,
      maxPages: 2,
      maxPagesTruncatesWithLimit: true,
      fetchPage: async () => [{ number: 1 }],
    });
    expect(result.items).toHaveLength(2);
    expect(result.list_truncated).toBe(true);
  });
});
