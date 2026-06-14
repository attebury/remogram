import { describe, it, expect } from 'vitest';
import { ERROR_CODES, paginateCheckStatusPages, fetchWithIngestPageBackoff } from '@remogram/core';

describe('check pagination ingest backoff', () => {
  it('paginateCheckStatusPages halves limit on oversized ingest', async () => {
    const limits = [];
    const items = await paginateCheckStatusPages({
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
    expect(items).toHaveLength(1);
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
