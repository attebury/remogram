import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forgePacket, PACKET_TYPES, DEFAULT_CHECK_STATUS_PAGE_SIZE, MAX_CHECK_STATUS_PAGES } from '@remogram/core';
import {
  provider,
  apiBase,
  repoApiPath,
  summarizeChecks,
  mergeability,
  graphqlEndpoint,
  graphqlPullToRestShape,
  githubFetchPaginated,
  listOpenPullsWithMeta,
} from '@remogram/provider-github-api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, '../fixtures/github-api');

function load(name) {
  return JSON.parse(readFileSync(join(fixtures, name), 'utf8'));
}

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

function graphqlResponse(name) {
  return jsonResponse(load(name));
}

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

const FIXTURE_HEAD_SHA = load('pull-graphql-clean.json').data.repository.pullRequest.headRefOid;

const ENVELOPE_KEYS = [
  'type',
  'schema_version',
  'provider_id',
  'remote_name',
  'repo_id',
  'observed_at',
  'ok',
];

const packetCtx = {
  providerId: 'github-api',
  remoteName: 'origin',
  repoId: 'owner/repo',
};

function bodyKeys(packet) {
  return Object.keys(packet).filter((k) => !ENVELOPE_KEYS.includes(k)).sort();
}

describe('repoApiPath', () => {
  it('encodes path segments', () => {
    expect(repoApiPath({ owner: 'a/b', repo: 'c' })).toContain(encodeURIComponent('a/b'));
  });
});

describe('apiBase', () => {
  it('binds public GitHub to api.github.com', () => {
    expect(apiBase(ctx.config, ctx.parsed)).toBe('https://api.github.com');
  });

  it('rejects public GitHub configured with another API host', () => {
    expect(() =>
      apiBase({ ...ctx.config, baseUrl: 'https://evil.example' }, ctx.parsed),
    ).toThrow(/github.com remotes/);
  });

  it('derives GitHub Enterprise API from the verified remote host', () => {
    expect(
      apiBase(
        { ...ctx.config, baseUrl: 'https://git.example.test' },
        { ...ctx.parsed, host: 'git.example.test' },
      ),
    ).toBe('https://git.example.test/api/v3');
  });

  it('rejects GitHub Enterprise API host mismatches before token use', () => {
    expect(() =>
      apiBase(
        { ...ctx.config, baseUrl: 'https://evil.example.test' },
        { ...ctx.parsed, host: 'git.example.test' },
      ),
    ).toThrow(/must match remote host git\.example\.test/);
  });

  it('binds public GitHub GraphQL to api.github.com/graphql', () => {
    expect(graphqlEndpoint(ctx.config, ctx.parsed)).toBe('https://api.github.com/graphql');
  });

  it('derives GitHub Enterprise GraphQL from the verified remote host', () => {
    expect(
      graphqlEndpoint(
        { ...ctx.config, baseUrl: 'https://git.example.test' },
        { ...ctx.parsed, host: 'git.example.test' },
      ),
    ).toBe('https://git.example.test/api/graphql');
  });
});

describe('provider-github-api fixtures', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.GITHUB_TOKEN = 'test-token';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
  });

  it('repoStatus returns gated capabilities without token', async () => {
    delete process.env.GITHUB_TOKEN;
    const body = await provider.repoStatus(ctx);
    expect(body.auth_present).toBe(false);
    expect(body.auth_env).toBeNull();
    expect(body.capabilities).toEqual(['repo_status']);
    expect(bodyKeys(forgePacket(PACKET_TYPES.REPO_STATUS, packetCtx, body))).toEqual([
      'auth_env',
      'auth_present',
      'capabilities',
      'default_branch',
    ]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('repoStatus prefers GITHUB_TOKEN and returns all capabilities with token', async () => {
    process.env.GH_TOKEN = 'fallback-token';
    global.fetch.mockResolvedValueOnce(jsonResponse(load('repo.json')));
    const body = await provider.repoStatus(ctx);
    expect(body.auth_present).toBe(true);
    expect(body.auth_env).toBe('GITHUB_TOKEN');
    expect(body.default_branch).toBe('main');
    expect(body.capabilities).toContain('pr_status');
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/owner/repo');
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token');
  });

  it('refsCompare resolves local refs and preserves shared packet body keys', async () => {
    const body = await provider.refsCompare(ctx, 'HEAD', 'HEAD');
    expect(body.base_ref).toBe('HEAD');
    expect(body.head_ref).toBe('HEAD');
    expect(body.base_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(body.head_sha).toBe(body.base_sha);
    expect(body.ahead_by).toBe(0);
    expect(body.behind_by).toBe(0);
    expect(bodyKeys(forgePacket(PACKET_TYPES.REF_COMPARE, packetCtx, body))).toEqual([
      'ahead_by',
      'base_ref',
      'base_sha',
      'behind_by',
      'head_ref',
      'head_sha',
    ]);
  });

  it('refsCompare works without forge token', async () => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    const body = await provider.refsCompare(ctx, 'HEAD', 'HEAD');
    expect(body.base_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('repoStatus falls back to GH_TOKEN', async () => {
    delete process.env.GITHUB_TOKEN;
    process.env.GH_TOKEN = 'gh-token';
    global.fetch.mockResolvedValueOnce(jsonResponse(load('repo.json')));
    const body = await provider.repoStatus(ctx);
    expect(body.auth_env).toBe('GH_TOKEN');
  });

  it('authenticated commands fail closed before fetch when token is missing', async () => {
    delete process.env.GITHUB_TOKEN;
    await expect(provider.prView(ctx, { number: 42 })).rejects.toMatchObject({
      forgeError: { code: 'unauthenticated_provider' },
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('prView maps mergeability via GraphQL and sanitizes fields', async () => {
    global.fetch.mockResolvedValueOnce(graphqlResponse('pull-graphql-clean.json'));
    const body = await provider.prView(ctx, { number: 42 });
    expect(body.pr_number).toBe(42);
    expect(body.mergeability).toBe('clean');
    expect(body.title).toBe('Add GitHub provider with newline');
    expect(body.base_ref).toBe('main');
    expect(body.head_sha).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.github.com/graphql');
    expect(global.fetch.mock.calls[0][1].method).toBe('POST');
    expect(bodyKeys(forgePacket(PACKET_TYPES.PR_STATUS, packetCtx, body))).toEqual([
      'base_ref',
      'base_sha',
      'head_ref',
      'head_sha',
      'mergeability',
      'pr_number',
      'state',
      'title',
      'url',
    ]);
  });

  it('maps dirty mergeability to conflicted', () => {
    const pr = graphqlPullToRestShape(load('pull-graphql-conflicted.json').data.repository.pullRequest);
    expect(mergeability(pr)).toBe('conflicted');
  });

  it('prChecks rejects option injection ref', async () => {
    await expect(provider.prChecks(ctx, { ref: '--show-toplevel' })).rejects.toMatchObject({
      forgeError: { code: 'invalid_args' },
    });
  });

  it('prChecks maps commit statuses plus check-runs to success conclusion', async () => {
    global.fetch
      .mockResolvedValueOnce(graphqlResponse('pull-graphql-clean.json'))
      .mockResolvedValueOnce(jsonResponse(load('statuses-success.json')))
      .mockResolvedValueOnce(jsonResponse(load('check-runs-success.json')));
    const body = await provider.prChecks(ctx, { number: 42 });
    expect(body.check_conclusion).toBe('success');
    expect(body.statuses).toEqual([
      { context: 'ci/status', state: 'success', description: 'status ok' },
      { context: 'ci/check', state: 'success', description: 'check ok' },
    ]);
    expect(bodyKeys(forgePacket(PACKET_TYPES.PR_CHECKS, packetCtx, body))).toEqual([
      'check_conclusion',
      'checks_truncated',
      'head_sha',
      'statuses',
    ]);
  });

  it('githubFetchPaginated rejects off-origin Link rel=next without fetching', async () => {
    const evilNext = 'https://evil.example/api/check-runs?page=2';
    global.fetch.mockImplementation((url) => {
      if (String(url).includes('evil.example')) {
        throw new Error('must not fetch untrusted pagination URL');
      }
      return Promise.resolve(
        jsonResponse(
          {
            check_runs: [
              {
                name: 'ci/page1',
                status: 'completed',
                conclusion: 'success',
                output: { title: 'page1 ok' },
              },
            ],
          },
          200,
          { link: `<${evilNext}>; rel="next"` },
        ),
      );
    });
    const result = await githubFetchPaginated(
      ctx.config,
      ctx.parsed,
      repoApiPath(ctx.config, 'commits', 'a'.repeat(40), 'check-runs'),
      (body) => body?.check_runs ?? [],
    );
    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(global.fetch.mock.calls.every(([u]) => !String(u).includes('evil.example'))).toBe(true);
  });

  it('githubFetchPaginated rejects same-origin off-path Link rel=next without fetching', async () => {
    const offPathNext = 'https://api.github.com/user/emails';
    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('/user/emails')) {
        throw new Error('must not fetch untrusted pagination URL');
      }
      return Promise.resolve(
        jsonResponse(
          {
            check_runs: [
              {
                name: 'ci/page1',
                status: 'completed',
                conclusion: 'success',
                output: { title: 'page1 ok' },
              },
            ],
          },
          200,
          { link: `<${offPathNext}>; rel="next"` },
        ),
      );
    });
    const result = await githubFetchPaginated(
      ctx.config,
      ctx.parsed,
      repoApiPath(ctx.config, 'commits', 'a'.repeat(40), 'check-runs'),
      (body) => body?.check_runs ?? [],
    );
    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(global.fetch.mock.calls.every(([u]) => !String(u).includes('/user/emails'))).toBe(true);
  });

  it('githubFetchPaginated follows relative same-origin Link rel=next', async () => {
    const page1Url =
      'https://api.github.com/repos/owner/repo/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/check-runs?per_page=25';
    const relativeNext = '/repos/owner/repo/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/check-runs?page=2';
    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.startsWith(page1Url)) {
        return Promise.resolve(
          jsonResponse(
            {
              check_runs: [
                {
                  name: 'ci/page1',
                  status: 'completed',
                  conclusion: 'success',
                  output: { title: 'page1 ok' },
                },
              ],
            },
            200,
            { link: `<${relativeNext}>; rel="next"` },
          ),
        );
      }
      if (href.includes('page=2')) {
        return Promise.resolve(
          jsonResponse({
            check_runs: [
              {
                name: 'ci/page2',
                status: 'completed',
                conclusion: 'success',
                output: { title: 'page2 ok' },
              },
            ],
          }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${href}`));
    });
    const result = await githubFetchPaginated(
      ctx.config,
      ctx.parsed,
      repoApiPath(ctx.config, 'commits', 'a'.repeat(40), 'check-runs'),
      (body) => body?.check_runs ?? [],
    );
    expect(result.truncated).toBe(false);
    expect(result.items.map((r) => r.name)).toEqual(['ci/page1', 'ci/page2']);
  });

  it('listOpenPullsWithMeta rejects off-origin Link rel=next without fetching', async () => {
    const evilNext = 'https://evil.example/api/pulls?page=2';
    global.fetch.mockImplementation((url) => {
      if (String(url).includes('evil.example')) {
        throw new Error('must not fetch untrusted pagination URL');
      }
      return Promise.resolve(
        jsonResponse([{ number: 1 }], 200, { link: `<${evilNext}>; rel="next"` }),
      );
    });
    const meta = await listOpenPullsWithMeta(ctx, {});
    expect(meta.list_truncated).toBe(true);
    expect(meta.numbers).toEqual([1]);
    expect(global.fetch.mock.calls.every(([u]) => !String(u).includes('evil.example'))).toBe(true);
  });

  it('listOpenPullsWithMeta rejects same-origin off-path Link rel=next without fetching', async () => {
    const offPathNext = 'https://api.github.com/user/emails';
    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('/user/emails')) {
        throw new Error('must not fetch untrusted pagination URL');
      }
      return Promise.resolve(
        jsonResponse([{ number: 1 }], 200, { link: `<${offPathNext}>; rel="next"` }),
      );
    });
    const meta = await listOpenPullsWithMeta(ctx, {});
    expect(meta.list_truncated).toBe(true);
    expect(meta.numbers).toEqual([1]);
    expect(global.fetch.mock.calls.every(([u]) => !String(u).includes('/user/emails'))).toBe(true);
  });

  it('listOpenPullsWithMeta follows relative same-origin Link rel=next', async () => {
    const relativeNext = '/repos/owner/repo/pulls?state=open&page=2';
    global.fetch.mockImplementation((url) => {
      const href = String(url);
      const page = new URL(href).searchParams.get('page');
      if (page === '2') {
        return Promise.resolve(jsonResponse([{ number: 2 }]));
      }
      if (href.includes('/pulls')) {
        return Promise.resolve(
          jsonResponse([{ number: 1 }], 200, { link: `<${relativeNext}>; rel="next"` }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${href}`));
    });
    const meta = await listOpenPullsWithMeta(ctx, {});
    expect(meta.list_truncated).toBe(false);
    expect(meta.numbers).toEqual([1, 2]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('listOpenPullsWithMeta survives oversized open PR list via ingest backoff', async () => {
    const paddedPulls = Array.from({ length: 25 }, (_, i) => ({
      number: i + 1,
      title: 'z'.repeat(400),
    }));
    const oversizedJson = JSON.stringify(paddedPulls);
    expect(Buffer.byteLength(oversizedJson, 'utf8')).toBeGreaterThan(8192);

    global.fetch.mockImplementation((url) => {
      const href = String(url);
      const perPage = Number(new URL(href).searchParams.get('per_page') || '25');
      if (perPage > 12) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          body: {
            [Symbol.asyncIterator]: async function* () {
              yield Buffer.from(oversizedJson);
            },
          },
        });
      }
      return Promise.resolve(jsonResponse([{ number: 1 }]));
    });

    const meta = await listOpenPullsWithMeta(ctx, {});
    expect(meta.numbers).toEqual([1]);
    expect(meta.list_truncated).toBe(false);
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('per_page=12'))).toBe(true);
  });

  it('listOpenPullsWithMeta limit branch survives oversized list via ingest backoff', async () => {
    const paddedPulls = Array.from({ length: 50 }, (_, i) => ({
      number: i + 1,
      title: 'z'.repeat(400),
    }));
    const oversizedJson = JSON.stringify(paddedPulls);
    expect(Buffer.byteLength(oversizedJson, 'utf8')).toBeGreaterThan(8192);

    global.fetch.mockImplementation((url) => {
      const href = String(url);
      const perPage = Number(new URL(href).searchParams.get('per_page') || '50');
      if (perPage > 12) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          body: {
            [Symbol.asyncIterator]: async function* () {
              yield Buffer.from(oversizedJson);
            },
          },
        });
      }
      return Promise.resolve(jsonResponse([{ number: 1 }]));
    });

    const meta = await listOpenPullsWithMeta(ctx, { limit: 50 });
    expect(meta.numbers).toEqual([1]);
    expect(meta.list_truncated).toBe(false);
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('per_page=12'))).toBe(true);
  });

  it('listOpenPullsWithMeta limit branch carries reduced per_page to page 2 after oversized page 1', async () => {
    const paddedPulls = Array.from({ length: 25 }, (_, i) => ({
      number: i + 1,
      title: 'z'.repeat(400),
    }));
    const oversizedJson = JSON.stringify(paddedPulls);
    const page2Pull = [{ number: 26 }];

    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (!href.includes('/pulls')) {
        return Promise.reject(new Error(`unexpected fetch: ${href}`));
      }
      const parsed = new URL(href);
      const perPage = Number(parsed.searchParams.get('per_page') || '25');
      const page = Number(parsed.searchParams.get('page') || '1');
      if (page === 1 && perPage > 12) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          body: {
            [Symbol.asyncIterator]: async function* () {
              yield Buffer.from(oversizedJson);
            },
          },
        });
      }
      if (page === 1) {
        return Promise.resolve(jsonResponse(paddedPulls.slice(0, 12)));
      }
      if (page === 2) {
        expect(perPage).toBe(12);
        return Promise.resolve(jsonResponse(page2Pull));
      }
      return Promise.resolve(jsonResponse([]));
    });

    const meta = await listOpenPullsWithMeta(ctx, { limit: 50 });
    expect(meta.numbers).toContain(26);
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('page=2') && String(u).includes('per_page=12'))).toBe(true);
  });

  it('mergePlan adds checks_incomplete when statuses stream hits off-origin Link next', async () => {
    const evilNext = 'https://evil.example/api/statuses?page=2';
    global.fetch
      .mockResolvedValueOnce(graphqlResponse('pull-graphql-clean.json'))
      .mockResolvedValueOnce(graphqlResponse('pull-graphql-clean.json'))
      .mockImplementation((url) => {
        const href = String(url);
        if (href.includes('evil.example')) {
          throw new Error('must not fetch untrusted pagination URL');
        }
        if (href.includes('/check-runs')) {
          return Promise.resolve(jsonResponse({ check_runs: [] }));
        }
        if (href.includes('/statuses')) {
          return Promise.resolve(
            jsonResponse(
              [{ context: 'ci/page1', state: 'success', description: 'ok' }],
              200,
              { link: `<${evilNext}>; rel="next"` },
            ),
          );
        }
        return Promise.reject(new Error(`unexpected fetch: ${href}`));
      });
    const body = await provider.mergePlan(ctx, { number: 42 });
    expect(body.checks_conclusion).toBe('success');
    expect(body.blockers).toContain('checks_incomplete');
    expect(global.fetch.mock.calls.every(([u]) => !String(u).includes('evil.example'))).toBe(true);
  });

  it('prChecks includes checks_failed when check-runs fail on page 2', async () => {
    const page2Url =
      'https://api.github.com/repos/owner/repo/commits/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/check-runs?page=2';
    global.fetch
      .mockResolvedValueOnce(graphqlResponse('pull-graphql-clean.json'))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            check_runs: [
              {
                name: 'ci/page1',
                status: 'completed',
                conclusion: 'success',
                output: { title: 'page1 ok' },
              },
            ],
          },
          200,
          { link: `<${page2Url}>; rel="next"` },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          check_runs: [
            {
              name: 'ci/page2',
              status: 'completed',
              conclusion: 'failure',
              output: { title: 'page2 fail' },
            },
          ],
        }),
      );
    const body = await provider.prChecks(ctx, { number: 42 });
    expect(body.check_conclusion).toBe('failure');
    const urls = global.fetch.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes(`per_page=${DEFAULT_CHECK_STATUS_PAGE_SIZE}`))).toBe(true);
  });

  it('prChecks survives oversized commit statuses via ingest backoff', async () => {
    const paddedStatuses = Array.from({ length: 25 }, (_, i) => ({
      context: `ci/pad-${i}`,
      state: 'success',
      description: 'z'.repeat(400),
    }));
    const oversizedJson = JSON.stringify(paddedStatuses);
    expect(Buffer.byteLength(oversizedJson, 'utf8')).toBeGreaterThan(8192);

    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('graphql')) {
        return Promise.resolve(graphqlResponse('pull-graphql-clean.json'));
      }
      if (href.includes('/check-runs')) {
        return Promise.resolve(jsonResponse({ check_runs: [] }));
      }
      if (href.includes('/statuses')) {
        const perPage = Number(new URL(href).searchParams.get('per_page') || '25');
        if (perPage > 12) {
          return Promise.resolve({
            ok: true,
            status: 200,
            body: {
              [Symbol.asyncIterator]: async function* () {
                yield Buffer.from(oversizedJson);
              },
            },
          });
        }
        return Promise.resolve(
          jsonResponse([{ context: 'ci/ok', state: 'success', description: 'ok' }]),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${href}`));
    });

    const body = await provider.prChecks(ctx, { number: 42 });
    expect(body.check_conclusion).toBe('success');
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('per_page=12'))).toBe(true);
  });

  it('prChecks includes checks_failed when commit statuses fail on page 2', async () => {
    const sha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const page2Url = `https://api.github.com/repos/owner/repo/commits/${sha}/statuses?page=2`;
    const page1Statuses = Array.from({ length: DEFAULT_CHECK_STATUS_PAGE_SIZE }, (_, i) => ({
      context: `ci/page1-${i}`,
      state: 'success',
      description: 'ok',
    }));

    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('graphql')) {
        return Promise.resolve(graphqlResponse('pull-graphql-clean.json'));
      }
      if (href.includes('/check-runs')) {
        return Promise.resolve(jsonResponse({ check_runs: [] }));
      }
      if (href.includes('/statuses') && href.includes('page=2')) {
        return Promise.resolve(
          jsonResponse([{ context: 'ci/page2-fail', state: 'failure', description: 'fail' }]),
        );
      }
      if (href.includes('/statuses')) {
        return Promise.resolve(
          jsonResponse(page1Statuses, 200, { link: `<${page2Url}>; rel="next"` }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${href}`));
    });

    const body = await provider.prChecks(ctx, { number: 42 });
    expect(body.check_conclusion).toBe('failure');
    const urls = global.fetch.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes('/statuses') && u.includes('page=2'))).toBe(true);
    expect(urls.some((u) => u.includes(`per_page=${DEFAULT_CHECK_STATUS_PAGE_SIZE}`))).toBe(true);
  });

  it('prChecks supports a local git ref without fetching the pull request', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(load('statuses-success.json')))
      .mockResolvedValueOnce(jsonResponse(load('check-runs-success.json')));
    const body = await provider.prChecks(ctx, { ref: 'HEAD' });
    expect(body.head_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(body.check_conclusion).toBe('success');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('summarizes missing, pending, failure, and unknown checks', () => {
    expect(summarizeChecks([])).toBe('missing');
    expect(summarizeChecks([{ state: 'pending' }])).toBe('pending');
    expect(summarizeChecks([{ state: 'failure' }, { state: 'success' }])).toBe('failure');
    expect(summarizeChecks([{ state: 'success' }, { state: 'unknown' }])).toBe('unknown');
  });

  it('mergePlan uses the shared blocker vocabulary', async () => {
    global.fetch
      .mockResolvedValueOnce(graphqlResponse('pull-graphql-conflicted.json'))
      .mockResolvedValueOnce(graphqlResponse('pull-graphql-conflicted.json'))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ check_runs: [] }));
    const body = await provider.mergePlan(ctx, { number: 43 });
    expect(body.mergeability).toBe('conflicted');
    expect(body.checks_conclusion).toBe('missing');
    expect(body.blockers).toEqual(['merge_conflict', 'checks_missing']);
    expect(bodyKeys(forgePacket(PACKET_TYPES.MERGE_PLAN, packetCtx, body))).toEqual([
      'blockers',
      'checks_conclusion',
      'mergeability',
      'pr_number',
    ]);
  });

  it('mergePlan reports the happy path with no blockers', async () => {
    global.fetch
      .mockResolvedValueOnce(graphqlResponse('pull-graphql-clean.json'))
      .mockResolvedValueOnce(graphqlResponse('pull-graphql-clean.json'))
      .mockResolvedValueOnce(jsonResponse(load('statuses-success.json')))
      .mockResolvedValueOnce(jsonResponse(load('check-runs-success.json')));
    const body = await provider.mergePlan(ctx, { number: 42 });
    expect(body.mergeability).toBe('clean');
    expect(body.checks_conclusion).toBe('success');
    expect(body.blockers).toEqual([]);
  });

  it('mergePlan includes checks_failed when check-runs fail on page 2', async () => {
    const page2Url =
      'https://api.github.com/repos/owner/repo/commits/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/check-runs?page=2';
    global.fetch
      .mockResolvedValueOnce(graphqlResponse('pull-graphql-clean.json'))
      .mockResolvedValueOnce(graphqlResponse('pull-graphql-clean.json'))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            check_runs: [
              {
                name: 'ci/page1',
                status: 'completed',
                conclusion: 'success',
                output: { title: 'page1 ok' },
              },
            ],
          },
          200,
          { link: `<${page2Url}>; rel="next"` },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          check_runs: [
            {
              name: 'ci/page2',
              status: 'completed',
              conclusion: 'failure',
              output: { title: 'page2 fail' },
            },
          ],
        }),
      );
    const body = await provider.mergePlan(ctx, { number: 42 });
    expect(body.checks_conclusion).toBe('failure');
    expect(body.blockers).toContain('checks_failed');
  });

  it('prChecks sets checks_truncated when status pages hit max_pages', async () => {
    const fullPageStatuses = Array.from({ length: DEFAULT_CHECK_STATUS_PAGE_SIZE }, (_, i) => ({
      context: `ci/cap-${i}`,
      state: 'success',
      description: 'ok',
    }));
    let statusFetchCount = 0;
    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('graphql')) {
        return Promise.resolve(graphqlResponse('pull-graphql-clean.json'));
      }
      if (href.includes('/check-runs')) {
        return Promise.resolve(jsonResponse({ check_runs: [] }));
      }
      if (href.includes('/statuses')) {
        statusFetchCount += 1;
        const nextUrl = `https://api.github.com/repos/owner/repo/commits/${FIXTURE_HEAD_SHA}/statuses?page=${statusFetchCount + 1}`;
        const linkHeader =
          statusFetchCount <= MAX_CHECK_STATUS_PAGES
            ? `<${nextUrl}>; rel="next"`
            : undefined;
        return Promise.resolve(jsonResponse(fullPageStatuses, 200, linkHeader ? { link: linkHeader } : {}));
      }
      return Promise.reject(new Error(`unexpected fetch: ${href}`));
    });
    const body = await provider.prChecks(ctx, { number: 42 });
    expect(body.checks_truncated).toBe(true);
    expect(body.statuses.length).toBe(DEFAULT_CHECK_STATUS_PAGE_SIZE * MAX_CHECK_STATUS_PAGES);
  });

  it('prChecks sets checks_truncated when check-runs stream hits max_pages', async () => {
    const fullPageCheckRuns = Array.from({ length: DEFAULT_CHECK_STATUS_PAGE_SIZE }, (_, i) => ({
      name: `ci/cap-${i}`,
      status: 'completed',
      conclusion: 'success',
      output: { title: 'ok' },
    }));
    let checkRunFetchCount = 0;
    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('graphql')) {
        return Promise.resolve(graphqlResponse('pull-graphql-clean.json'));
      }
      if (href.includes('/statuses')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (href.includes('/check-runs')) {
        checkRunFetchCount += 1;
        const nextUrl = `https://api.github.com/repos/owner/repo/commits/${FIXTURE_HEAD_SHA}/check-runs?page=${checkRunFetchCount + 1}`;
        const linkHeader =
          checkRunFetchCount <= MAX_CHECK_STATUS_PAGES
            ? `<${nextUrl}>; rel="next"`
            : undefined;
        return Promise.resolve(
          jsonResponse(
            { check_runs: fullPageCheckRuns },
            200,
            linkHeader ? { link: linkHeader } : {},
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${href}`));
    });
    const body = await provider.prChecks(ctx, { number: 42 });
    expect(body.checks_truncated).toBe(true);
    expect(body.statuses.length).toBe(DEFAULT_CHECK_STATUS_PAGE_SIZE * MAX_CHECK_STATUS_PAGES);
  });

  it('mergePlan adds checks_incomplete when check enumeration truncates', async () => {
    const fullPageStatuses = Array.from({ length: DEFAULT_CHECK_STATUS_PAGE_SIZE }, (_, i) => ({
      context: `ci/cap-${i}`,
      state: 'success',
      description: 'ok',
    }));
    let statusFetchCount = 0;
    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('graphql')) {
        return Promise.resolve(graphqlResponse('pull-graphql-clean.json'));
      }
      if (href.includes('/check-runs')) {
        return Promise.resolve(jsonResponse({ check_runs: [] }));
      }
      if (href.includes('/statuses')) {
        statusFetchCount += 1;
        const nextUrl = `https://api.github.com/repos/owner/repo/commits/${FIXTURE_HEAD_SHA}/statuses?page=${statusFetchCount + 1}`;
        const linkHeader =
          statusFetchCount <= MAX_CHECK_STATUS_PAGES
            ? `<${nextUrl}>; rel="next"`
            : undefined;
        return Promise.resolve(jsonResponse(fullPageStatuses, 200, linkHeader ? { link: linkHeader } : {}));
      }
      return Promise.reject(new Error(`unexpected fetch: ${href}`));
    });
    const body = await provider.mergePlan(ctx, { number: 42 });
    expect(body.checks_conclusion).toBe('success');
    expect(body.blockers).toContain('checks_incomplete');
  });

  it('mergePlan adds checks_incomplete when check-runs enumeration truncates', async () => {
    const fullPageCheckRuns = Array.from({ length: DEFAULT_CHECK_STATUS_PAGE_SIZE }, (_, i) => ({
      name: `ci/cap-${i}`,
      status: 'completed',
      conclusion: 'success',
      output: { title: 'ok' },
    }));
    let checkRunFetchCount = 0;
    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('graphql')) {
        return Promise.resolve(graphqlResponse('pull-graphql-clean.json'));
      }
      if (href.includes('/statuses')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (href.includes('/check-runs')) {
        checkRunFetchCount += 1;
        const nextUrl = `https://api.github.com/repos/owner/repo/commits/${FIXTURE_HEAD_SHA}/check-runs?page=${checkRunFetchCount + 1}`;
        const linkHeader =
          checkRunFetchCount <= MAX_CHECK_STATUS_PAGES
            ? `<${nextUrl}>; rel="next"`
            : undefined;
        return Promise.resolve(
          jsonResponse(
            { check_runs: fullPageCheckRuns },
            200,
            linkHeader ? { link: linkHeader } : {},
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${href}`));
    });
    const body = await provider.mergePlan(ctx, { number: 42 });
    expect(body.checks_conclusion).toBe('success');
    expect(body.blockers).toContain('checks_incomplete');
  });

  it('providerCapabilities reports supported pagination', () => {
    const caps = provider.providerCapabilities();
    expect(caps.pagination).toBe('supported');
    expect(caps.forge_ingest_cap_bytes).toBe(8192);
    expect(caps.check_pagination.check_source_count).toBe(caps.check_sources.length);
    expect(caps.check_pagination).toEqual({
      strategy: 'link_header',
      page_size: 25,
      max_pages: 50,
      page_size_param: 'per_page',
      ingest_backoff: 'halve_until_fit',
      on_page_cap: 'set_checks_truncated',
      compliant_max_items_per_source: 1250,
      check_source_count: 2,
      truncation_combination: 'any_source_truncated',
      compliant_max_items_total: 2500,
      truncation_packet_field: 'checks_truncated',
    });
  });

  it('syncPlan preserves shared packet body keys', async () => {
    const body = await provider.syncPlan(ctx, 'origin');
    expect(body.remote).toBe('origin');
    expect(body.local_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(Array.isArray(body.blockers)).toBe(true);
    expect(bodyKeys(forgePacket(PACKET_TYPES.SYNC_PLAN, packetCtx, body))).toEqual([
      'blockers',
      'diverged',
      'local_sha',
      'remote',
      'remote_sha',
    ]);
  });

  it('propagates redirect rejection from core HTTP helper', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 302,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('');
        },
      },
    });
    await expect(provider.repoStatus(ctx)).rejects.toMatchObject({
      forgeError: { code: 'api_error', message: 'HTTP redirect rejected' },
    });
  });
});
