import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchJson, fetchTextCapped, ERROR_CODES, DEFAULT_MAX_BYTES } from '@remogram/core';

function mockResponse({ status = 200, body = '', ok = status >= 200 && status < 300 } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const bytes = Buffer.from(text);
  return {
    status,
    ok,
    statusText: ok ? 'OK' : 'Error',
    body: {
      [Symbol.asyncIterator]: async function* () {
        yield bytes;
      },
    },
  };
}

describe('fetchJson edge cases', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects oversized JSON body', async () => {
    const big = 'x'.repeat(DEFAULT_MAX_BYTES + 100);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ body: `{ "x": "${big}" }` })));

    await expect(fetchJson('http://localhost:3000/api')).rejects.toMatchObject({
      forgeError: { code: ERROR_CODES.OVERSIZED_RAW_OUTPUT },
    });
  });

  it('rejects invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ body: '{not json' })));

    await expect(fetchJson('http://localhost:3000/api')).rejects.toMatchObject({
      forgeError: { code: ERROR_CODES.UNPARSEABLE_PROVIDER_OUTPUT },
    });
  });

  it('sanitizes non-OK API error messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockResponse({
          status: 500,
          ok: false,
          body: { message: 'fail\ninject' },
        }),
      ),
    );

    await expect(fetchJson('http://localhost:3000/api')).rejects.toMatchObject({
      forgeError: { code: ERROR_CODES.API_ERROR, message: 'fail inject' },
    });
  });

  it('sanitizes non-OK fetchTextCapped error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockResponse({
          status: 502,
          ok: false,
          body: 'bad\ncontrol\x01chars',
        }),
      ),
    );

    await expect(fetchTextCapped('http://localhost:3000/raw')).rejects.toMatchObject({
      forgeError: { code: ERROR_CODES.API_ERROR, message: 'bad control chars' },
    });
  });

  it('rejects redirects in fetchTextCapped', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 301,
        ok: false,
        body: null,
      }),
    );

    await expect(fetchTextCapped('http://localhost:3000/x')).rejects.toMatchObject({
      forgeError: { code: ERROR_CODES.API_ERROR, message: 'HTTP redirect rejected' },
    });
  });
});
