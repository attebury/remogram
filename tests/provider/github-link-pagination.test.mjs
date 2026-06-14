import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MAX_CHECK_STATUS_PAGES } from '@remogram/core';
import {
  resolveGitHubLinkNextPage,
  listOpenPullsWithMeta,
} from '@remogram/provider-github-api';

const TRUSTED = 'https://api.github.com';

const ctx = {
  config: {
    provider: 'github-api',
    owner: 'owner',
    repo: 'repo',
    baseUrl: 'https://github.com',
    remote: 'origin',
  },
  cwd: process.cwd(),
  parsed: { owner: 'owner', repo: 'repo', host: 'github.com' },
};

function jsonResponse(body, status = 200, { link } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: link
      ? {
          get: (name) => (String(name).toLowerCase() === 'link' ? link : null),
        }
      : undefined,
    body: {
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify(body));
      },
    },
  };
}

describe('resolveGitHubLinkNextPage', () => {
  const currentUrl =
    'https://api.github.com/repos/owner/repo/pulls?state=open&per_page=100';

  it('follows trusted relative same-origin next', () => {
    const relativeNext = '/repos/owner/repo/pulls?state=open&page=2';
    const result = resolveGitHubLinkNextPage({
      trustedOrigin: TRUSTED,
      currentUrl,
      linkHeader: `<${relativeNext}>; rel="next"`,
      pageIndex: 0,
      maxPages: MAX_CHECK_STATUS_PAGES,
    });
    expect(result.truncated).toBe(false);
    expect(result.nextUrl).toBe('https://api.github.com/repos/owner/repo/pulls?state=open&page=2');
  });

  it('truncates on same-origin off-path next', () => {
    const result = resolveGitHubLinkNextPage({
      trustedOrigin: TRUSTED,
      currentUrl,
      linkHeader: '<https://api.github.com/user/emails>; rel="next"',
      pageIndex: 0,
      maxPages: MAX_CHECK_STATUS_PAGES,
    });
    expect(result.nextUrl).toBe(null);
    expect(result.truncated).toBe(true);
  });

  it('truncates at maxPages boundary', () => {
    const result = resolveGitHubLinkNextPage({
      trustedOrigin: TRUSTED,
      currentUrl,
      linkHeader: '<https://api.github.com/repos/owner/repo/pulls?page=2>; rel="next"',
      pageIndex: MAX_CHECK_STATUS_PAGES - 1,
      maxPages: MAX_CHECK_STATUS_PAGES,
    });
    expect(result.nextUrl).toBe(null);
    expect(result.truncated).toBe(true);
  });

  it('resolves rel=\'next\' with single quotes', () => {
    const relativeNext = '/repos/owner/repo/pulls?state=open&page=2';
    const result = resolveGitHubLinkNextPage({
      trustedOrigin: TRUSTED,
      currentUrl,
      linkHeader: `<${relativeNext}>; rel='next'`,
      pageIndex: 0,
      maxPages: MAX_CHECK_STATUS_PAGES,
    });
    expect(result.truncated).toBe(false);
    expect(result.nextUrl).toContain('page=2');
  });

  it('accepts trailing-slash pathname on next URL', () => {
    const result = resolveGitHubLinkNextPage({
      trustedOrigin: TRUSTED,
      currentUrl,
      linkHeader:
        '<https://api.github.com/repos/owner/repo/pulls/?state=open&page=2>; rel="next"',
      pageIndex: 0,
      maxPages: MAX_CHECK_STATUS_PAGES,
    });
    expect(result.truncated).toBe(false);
    expect(result.nextUrl).toContain('page=2');
  });
});

describe('listOpenPullsWithMeta Link boundary chains', () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'test-token';
    global.fetch = vi.fn();
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
    vi.restoreAllMocks();
  });

  it('follows rel=\'next\' on Link-mode list', async () => {
    const relativeNext = '/repos/owner/repo/pulls?state=open&page=2';
    global.fetch.mockImplementation((url) => {
      const href = String(url);
      const page = new URL(href).searchParams.get('page');
      if (page === '2') {
        return Promise.resolve(jsonResponse([{ number: 2 }]));
      }
      if (href.includes('/pulls')) {
        return Promise.resolve(
          jsonResponse([{ number: 1 }], 200, { link: `<${relativeNext}>; rel='next'` }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${href}`));
    });
    const meta = await listOpenPullsWithMeta(ctx, {});
    expect(meta.list_truncated).toBe(false);
    expect(meta.numbers).toEqual([1, 2]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('follows trailing-slash Link pathname on list pagination', async () => {
    const nextUrl =
      'https://api.github.com/repos/owner/repo/pulls/?state=open&page=2&per_page=100';
    global.fetch.mockImplementation((url) => {
      const href = String(url);
      const page = new URL(href).searchParams.get('page');
      if (page === '2') {
        return Promise.resolve(jsonResponse([{ number: 2 }]));
      }
      if (href.includes('/pulls')) {
        return Promise.resolve(
          jsonResponse([{ number: 1 }], 200, { link: `<${nextUrl}>; rel="next"` }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${href}`));
    });
    const meta = await listOpenPullsWithMeta(ctx, {});
    expect(meta.list_truncated).toBe(false);
    expect(meta.numbers).toEqual([1, 2]);
  });
});
