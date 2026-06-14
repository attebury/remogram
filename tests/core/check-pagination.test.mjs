import { describe, it, expect } from 'vitest';
import { ERROR_CODES, paginateCheckStatusPages, fetchWithIngestPageBackoff } from '@remogram/core';

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
