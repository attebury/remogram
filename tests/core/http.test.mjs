import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchJson, ERROR_CODES } from '@remogram/core';

describe('fetchJson redirect policy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects HTTP redirects without following', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 302,
        ok: false,
        body: null,
      }),
    );

    await expect(fetchJson('http://localhost:3000/api/v1/repos/o/r')).rejects.toMatchObject({
      forgeError: { code: ERROR_CODES.API_ERROR, message: 'HTTP redirect rejected' },
    });
  });
});
