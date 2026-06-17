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
import { MAX_OPEN_PULL_IDEMPOTENCY_PAGES } from '@remogram/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, '../fixtures/github-api');

function load(name) {
  return JSON.parse(readFileSync(join(fixtures, name), 'utf8'));
}

function jsonResponse(body, status = 200, { link, headers = {} } = {}) {
  const headerEntries = { ...headers };
  if (link) headerEntries.link = link;
  const headerMap = new Map(Object.entries(headerEntries));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      get: (name) => headerMap.get(name) ?? headerMap.get(String(name).toLowerCase()) ?? null,
    },
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

function mockMergePlanGithubFetch({ filesResponse }) {
  global.fetch.mockImplementation((url) => {
    const href = String(url);
    if (href.includes('graphql')) {
      return Promise.resolve(graphqlResponse('pull-graphql-clean.json'));
    }
    if (href.includes('/statuses')) {
      return Promise.resolve(jsonResponse(load('statuses-success.json')));
    }
    if (href.includes('/check-runs')) {
      return Promise.resolve(jsonResponse(load('check-runs-success.json')));
    }
    if (href.includes('/pulls/42/files')) {
      return filesResponse(href);
    }
    return Promise.reject(new Error(`unexpected fetch: ${href}`));
  });
}

const ctx = {
  config: {
    provider: 'github-api',
    owner: 'owner',
    repo: 'repo',
    baseUrl: 'https://github.com',
    remote: 'origin',
    write_commands: ['status_set'],
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
    expect(body.capabilities).toContain('whoami');
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/owner/repo');
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token');
  });

  it('whoami reads GitHub user and X-OAuth-Scopes header', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonResponse(load('user.json'), 200, {
        headers: { 'X-OAuth-Scopes': 'repo, read:user' },
      }),
    );
    const body = await provider.whoami(ctx);
    expect(body.login).toBe('octocat');
    expect(body.can_write).toBe(true);
    expect(body.token_scope_signal).toEqual({ implemented: true, scopes: ['repo', 'read:user'] });
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.github.com/user');
  });

  it('whoami reports implemented false scope signal when header absent', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(load('user.json')));
    const body = await provider.whoami(ctx);
    expect(body.token_scope_signal).toEqual({ implemented: false, scopes: null });
  });

  it('branchProtection normalizes GitHub branch protection policy', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(load('branch-protection-main.json')));
    const body = await provider.branchProtection(ctx, { branchRef: 'main' });
    expect(body.branch_ref).toBe('main');
    expect(body.required_status_contexts).toEqual([
      'CI Gate / CI gate (pull_request)',
      'ci/lint',
    ]);
    expect(body.approvals_required).toEqual({ implemented: true, count: 2 });
    expect(global.fetch.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/owner/repo/branches/main/protection',
    );
  });

  it('branchProtection returns empty policy when branch is unprotected (404)', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonResponse({ message: 'Branch not protected' }, 404),
    );
    const body = await provider.branchProtection(ctx, { branchRef: 'main' });
    expect(body.required_status_contexts).toEqual([]);
    expect(body.protected_branch_rules).toEqual([]);
    expect(body.approvals_required).toEqual({ implemented: false, count: null });
  });

  it('crFiles normalizes GitHub pull request file list', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(load('pull-files.json')));
    const body = await provider.crFiles(ctx, { number: 42 });
    expect(body.pr_number).toBe(42);
    expect(body.changed_paths).toEqual([
      'packages/remogram-core/foo.js',
      'tests/core/foo.test.mjs',
    ]);
    expect(body.paths_truncated).toBe(false);
    expect(global.fetch.mock.calls[0][0]).toMatch(
      /repos\/owner\/repo\/pulls\/42\/files\?per_page=\d+$/,
    );
  });

  it('crComments normalizes GitHub pull request review comments', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(load('pull-comments.json')));
    const body = await provider.crComments(ctx, { number: 42 });
    expect(body.pr_number).toBe(42);
    expect(body.comments).toHaveLength(2);
    expect(body.comments[0]).toMatchObject({
      id: '1001',
      author: 'reviewer-bot',
      path: 'packages/remogram-core/cr-comments.js',
      line: 12,
      resolved: false,
    });
    expect(body.comments[1].author).not.toContain('\n');
    expect(body.comments[1].body).not.toContain('ghp_');
    expect(body.comments[1].body).toContain('[REDACTED]');
    expect(body.comments_truncated).toBe(false);
    expect(global.fetch.mock.calls[0][0]).toMatch(
      /repos\/owner\/repo\/pulls\/42\/comments\?per_page=\d+$/,
    );
  });

  const STATUS_SHA = 'cccccccccccccccccccccccccccccccccccccccc';

  it('statusSet POSTs commit status and maps response', async () => {
    const fixture = load('status-set-post.json');
    global.fetch.mockResolvedValueOnce(jsonResponse([]));
    global.fetch.mockResolvedValueOnce(jsonResponse(fixture, 201));
    const body = await provider.statusSet(ctx, {
      sha: STATUS_SHA,
      context: 'verify/wave1',
      state: 'success',
      description: 'Verification passed',
      target_url: 'https://github.com/owner/repo/actions/runs/1',
    });
    expect(body.sha).toBe(STATUS_SHA);
    expect(body.context).toBe('verify/wave1');
    expect(body.state).toBe('success');
    expect(body.description).toBe('Verification passed');
    expect(global.fetch.mock.calls[1][1]?.method).toBe('POST');
    const postBody = JSON.parse(global.fetch.mock.calls[1][1]?.body);
    expect(postBody).toMatchObject({
      state: 'success',
      context: 'verify/wave1',
      description: 'Verification passed',
      target_url: 'https://github.com/owner/repo/actions/runs/1',
    });
    expect(global.fetch.mock.calls[0][0]).toMatch(
      /repos\/owner\/repo\/commits\/cccccccccccccccccccccccccccccccccccccccc\/statuses\?per_page=\d+$/,
    );
  });

  it('statusSet returns reused_existing without POST when context and state match', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 7,
          context: 'verify/wave1',
          state: 'success',
          description: 'Already set',
          updated_at: '2026-06-15T00:00:00Z',
        },
      ]),
    );
    const body = await provider.statusSet(ctx, {
      sha: STATUS_SHA,
      context: 'verify/wave1',
      state: 'success',
    });
    expect(body.reused_existing).toBe(true);
    expect(body.state).toBe('success');
    expect(body.description).toBe('Already set');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][1]?.method).toBeUndefined();
  });

  it('statusSet POSTs overwrite when existing state differs', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 8,
          context: 'verify/wave1',
          state: 'pending',
          updated_at: '2026-06-15T00:00:00Z',
        },
      ]),
    );
    global.fetch.mockResolvedValueOnce(
      jsonResponse({ id: 9, context: 'verify/wave1', state: 'success' }, 201),
    );
    const body = await provider.statusSet(ctx, {
      sha: STATUS_SHA,
      context: 'verify/wave1',
      state: 'success',
    });
    expect(body.state).toBe('success');
    expect(body.reused_existing).toBeUndefined();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][1]?.method).toBe('POST');
  });

  it('statusSet reuses latest matching context by updated_at order', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 10,
          context: 'verify/wave1',
          state: 'success',
          description: 'older',
          updated_at: '2026-06-14T00:00:00Z',
        },
        {
          id: 11,
          context: 'verify/wave1',
          state: 'success',
          description: 'newer',
          updated_at: '2026-06-15T00:00:00Z',
        },
      ]),
    );
    const body = await provider.statusSet(ctx, {
      sha: STATUS_SHA,
      context: 'verify/wave1',
      state: 'success',
    });
    expect(body.reused_existing).toBe(true);
    expect(body.description).toBe('newer');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('statusSet fails closed with idempotency_scan metadata when scan is truncated', async () => {
    const fullPage = Array.from({ length: DEFAULT_CHECK_STATUS_PAGE_SIZE }, (_, i) => ({
      id: i + 1,
      context: `other/${i}`,
      state: 'success',
    }));
    for (let page = 1; page <= MAX_OPEN_PULL_IDEMPOTENCY_PAGES; page += 1) {
      const next =
        page < MAX_OPEN_PULL_IDEMPOTENCY_PAGES
          ? `<https://api.github.com/repos/owner/repo/commits/${STATUS_SHA}/statuses?page=${page + 1}&per_page=${DEFAULT_CHECK_STATUS_PAGE_SIZE}>; rel="next"`
          : undefined;
      global.fetch.mockResolvedValueOnce(jsonResponse(fullPage, 200, { link: next }));
    }
    await expect(
      provider.statusSet(ctx, {
        sha: STATUS_SHA,
        context: 'verify/wave1',
        state: 'success',
      }),
    ).rejects.toMatchObject({
      forgeError: expect.objectContaining({
        code: 'idempotency_scan_incomplete',
        fields: {
          idempotency_scan: expect.objectContaining({
            pages: MAX_OPEN_PULL_IDEMPOTENCY_PAGES,
            max_pages: MAX_OPEN_PULL_IDEMPOTENCY_PAGES,
          }),
        },
      }),
    });
    expect(global.fetch.mock.calls.every((call) => call[1]?.method !== 'POST')).toBe(true);
  });

  it('forgeChanges normalizes GitHub pull activity since boundary', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(load('pulls-since-window.json')))
      .mockResolvedValueOnce(jsonResponse(load('pull-graphql-clean.json')))
      .mockResolvedValueOnce(jsonResponse(load('statuses-success.json')))
      .mockResolvedValueOnce(jsonResponse({ check_runs: [] }))
      .mockResolvedValueOnce(jsonResponse(load('pull-graphql-clean.json')))
      .mockResolvedValueOnce(jsonResponse(load('statuses-success.json')))
      .mockResolvedValueOnce(jsonResponse({ check_runs: [] }));
    const body = await provider.forgeChanges(ctx, { since: '2024-06-01T12:00:00Z' });
    expect(body.since).toBe('2024-06-01T12:00:00.000Z');
    expect(body.since_kind).toBe('observed_at');
    expect(body.events.map((event) => event.kind)).toEqual([
      'pr_opened',
      'pr_merged',
      'pr_closed',
      'head_sha_moved',
      'checks_conclusion_observed',
      'checks_conclusion_observed',
    ]);
    expect(body.events_truncated).toBe(false);
    expect(body.event_count).toBe(6);
    expect(global.fetch.mock.calls[0][0]).toMatch(
      /repos\/owner\/repo\/pulls\?state=all&sort=updated&direction=desc&per_page=\d+$/,
    );
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

  it('githubFetchPaginated rejects userinfo Link rel=next without fetching', async () => {
    const userinfoNext =
      'https://evil@api.github.com/repos/owner/repo/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/check-runs?page=2';
    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('evil@')) {
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
          { link: `<${userinfoNext}>; rel="next"` },
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
    expect(global.fetch.mock.calls.every(([u]) => !String(u).includes('evil@'))).toBe(true);
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

  it('listOpenPullsWithMeta rejects userinfo Link rel=next without fetching', async () => {
    const userinfoNext = 'https://evil@api.github.com/repos/owner/repo/pulls?page=2';
    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('evil@')) {
        throw new Error('must not fetch untrusted pagination URL');
      }
      return Promise.resolve(
        jsonResponse([{ number: 1 }], 200, { link: `<${userinfoNext}>; rel="next"` }),
      );
    });
    const meta = await listOpenPullsWithMeta(ctx, {});
    expect(meta.list_truncated).toBe(true);
    expect(meta.numbers).toEqual([1]);
    expect(global.fetch.mock.calls.every(([u]) => !String(u).includes('evil@'))).toBe(true);
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

  it('listOpenPullsWithMeta Link branch carries reduced per_page to page 2 after oversized page 1', async () => {
    const paddedPulls = Array.from({ length: 25 }, (_, i) => ({
      number: i + 1,
      title: 'z'.repeat(400),
    }));
    const oversizedJson = JSON.stringify(paddedPulls);
    const relativeNext = '/repos/owner/repo/pulls?state=open&page=2&per_page=100';

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
        return Promise.resolve(
          jsonResponse(
            paddedPulls.slice(0, 12).map((p) => ({ number: p.number })),
            200,
            { link: `<${relativeNext}>; rel="next"` },
          ),
        );
      }
      if (page === 2) {
        expect(perPage).toBe(12);
        return Promise.resolve(jsonResponse([{ number: 26 }]));
      }
      return Promise.resolve(jsonResponse([]));
    });

    const meta = await listOpenPullsWithMeta(ctx, {});
    expect(meta.numbers).toContain(26);
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('page=2') && String(u).includes('per_page=12'))).toBe(true);
  });

  it('githubFetchPaginated carries reduced per_page to Link page 2 after oversized page 1', async () => {
    const paddedRuns = Array.from({ length: 25 }, (_, i) => ({
      name: `ci/${i}`,
      status: 'completed',
      conclusion: 'success',
      output: { title: 'z'.repeat(400) },
    }));
    const oversizedJson = JSON.stringify({ check_runs: paddedRuns });
    const sha = 'a'.repeat(40);
    const relativeNext = `/repos/owner/repo/commits/${sha}/check-runs?page=2&per_page=100`;

    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (!href.includes('/check-runs')) {
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
        return Promise.resolve(
          jsonResponse(
            { check_runs: paddedRuns.slice(0, 12) },
            200,
            { link: `<${relativeNext}>; rel="next"` },
          ),
        );
      }
      if (page === 2) {
        expect(perPage).toBe(12);
        return Promise.resolve(jsonResponse({ check_runs: [{ name: 'ci/last', status: 'completed', conclusion: 'success' }] }));
      }
      return Promise.resolve(jsonResponse({ check_runs: [] }));
    });

    const result = await githubFetchPaginated(
      ctx.config,
      ctx.parsed,
      repoApiPath(ctx.config, 'commits', sha, 'check-runs'),
      (body) => body?.check_runs ?? [],
    );
    expect(result.items.some((run) => run.name === 'ci/last')).toBe(true);
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

  it('mergePlan rethrows oversized_raw_output with allowed_paths when files exceed ingest cap', async () => {
    const manyFiles = Array.from({ length: 257 }, (_, i) => ({
      sha: `sha${i}`,
      filename: `packages/file-${i}.js`,
      status: 'added',
    }));
    mockMergePlanGithubFetch({
      filesResponse: () => Promise.resolve(jsonResponse(manyFiles)),
    });
    await expect(
      provider.mergePlan(ctx, { number: 42, allowed_paths: ['packages/**'] }),
    ).rejects.toMatchObject({
      forgeError: { code: 'oversized_raw_output' },
    });
  });

  it('mergePlan blocks on Link-pagination paths_truncated with allowed_paths', async () => {
    const evilNext = 'https://evil.example/api/pulls/42/files?page=2';
    mockMergePlanGithubFetch({
      filesResponse: () =>
        Promise.resolve(
          jsonResponse(
            [{ sha: 'abc', filename: 'packages/foo.js', status: 'added' }],
            200,
            { link: `<${evilNext}>; rel="next"` },
          ),
        ),
    });
    const body = await provider.mergePlan(ctx, {
      number: 42,
      allowed_paths: ['packages/**'],
    });
    expect(body.blockers).toContain('changed_paths_unavailable');
    expect(body.blockers).not.toContain('path_scope_violation');
    expect(global.fetch.mock.calls.every(([u]) => !String(u).includes('evil.example'))).toBe(true);
  });

  it('mergePlan passes in-scope allowlist with complete forge paths', async () => {
    mockMergePlanGithubFetch({
      filesResponse: () => Promise.resolve(jsonResponse(load('pull-files.json'))),
    });
    const body = await provider.mergePlan(ctx, {
      number: 42,
      allowed_paths: ['packages/**', 'tests/**'],
    });
    expect(body.blockers).not.toContain('changed_paths_unavailable');
    expect(body.blockers).not.toContain('path_scope_violation');
  });

  it('mergePlan rethrows unauthenticated when allowlist set without token', async () => {
    delete process.env.GITHUB_TOKEN;
    await expect(
      provider.mergePlan(ctx, { number: 42, allowed_paths: ['packages/**'] }),
    ).rejects.toMatchObject({
      forgeError: { code: 'unauthenticated_provider' },
    });
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

  it('listOpenPullsWithMeta fast path uses search total_count with retain_max', async () => {
    global.fetch
      .mockResolvedValueOnce(
        jsonResponse({ total_count: 2, incomplete_results: false, items: [] }),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          { number: 30, state: 'open' },
          { number: 10, state: 'open' },
        ]),
      );
    const meta = await listOpenPullsWithMeta(ctx, { retain_max: 2, sort: 'recent_update' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(String(global.fetch.mock.calls[0][0])).toContain('/search/issues');
    expect(String(global.fetch.mock.calls[1][0])).toContain('sort=updated');
    expect(meta.entry_count).toBe(2);
    expect(meta.list_truncated).toBe(false);
    expect(meta.numbers).toEqual([30, 10]);
    expect(meta.slice_sort).toBe('recent_update');
  });

  it('listOpenPullsWithMeta falls back when search incomplete_results is true', async () => {
    global.fetch
      .mockResolvedValueOnce(
        jsonResponse({ total_count: 2, incomplete_results: true, items: [] }),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ number: 1, state: 'open' }]),
      );
    const meta = await listOpenPullsWithMeta(ctx, { retain_max: 2 });
    expect(global.fetch.mock.calls.length).toBeGreaterThan(1);
    expect(meta.numbers).toEqual([1]);
  });

  it('listOpenPullsWithMeta falls back when list body shorter than min(total, limit)', async () => {
    global.fetch
      .mockResolvedValueOnce(
        jsonResponse({ total_count: 5, incomplete_results: false, items: [] }),
      )
      .mockResolvedValueOnce(jsonResponse([{ number: 1, state: 'open' }]));
    const meta = await listOpenPullsWithMeta(ctx, { retain_max: 3, sort: 'recent_update' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(meta.entry_count).toBe(5);
    expect(meta.numbers).toEqual([1]);
    expect(meta.list_truncated).toBe(true);
  });

  it('listOpenPullsWithMeta recent_update body mismatch preserves search entry_count', async () => {
    global.fetch
      .mockResolvedValueOnce(
        jsonResponse({ total_count: 5, incomplete_results: false, items: [] }),
      )
      .mockResolvedValueOnce(jsonResponse([{ number: 42, state: 'open' }]));
    const meta = await listOpenPullsWithMeta(ctx, { retain_max: 3, sort: 'recent_update' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(meta.entry_count).toBe(5);
    expect(meta.list_truncated).toBe(true);
    expect(meta.slice_sort).toBe('recent_update');
  });

  it('listOpenPullsWithMeta preserves search total_count on number_asc fallback', async () => {
    const allMrs = [
      { number: 30, state: 'open' },
      { number: 10, state: 'open' },
      { number: 20, state: 'open' },
      { number: 5, state: 'open' },
      { number: 1, state: 'open' },
      { number: 7, state: 'open' },
      { number: 8, state: 'open' },
      { number: 9, state: 'open' },
      { number: 2, state: 'open' },
      { number: 3, state: 'open' },
    ];
    global.fetch
      .mockResolvedValueOnce(
        jsonResponse({ total_count: 10, incomplete_results: false, items: [] }),
      )
      .mockResolvedValueOnce(jsonResponse(allMrs.slice(0, 3)))
      .mockResolvedValueOnce(jsonResponse(allMrs.slice(3, 6)))
      .mockResolvedValueOnce(jsonResponse(allMrs.slice(6, 9)))
      .mockResolvedValueOnce(jsonResponse(allMrs.slice(9)));
    const meta = await listOpenPullsWithMeta(ctx, { retain_max: 3, sort: 'number_asc' });
    expect(global.fetch).toHaveBeenCalledTimes(5);
    expect(meta.entry_count).toBe(10);
    expect(meta.numbers).toEqual([1, 2, 3]);
  });

  it('listOpenPullsWithMeta skips fast path for number_asc when search total exceeds retain_max', async () => {
    global.fetch
      .mockResolvedValueOnce(
        jsonResponse({ total_count: 10, incomplete_results: false, items: [] }),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          { number: 30, state: 'open' },
          { number: 10, state: 'open' },
          { number: 20, state: 'open' },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse([]));
    const meta = await listOpenPullsWithMeta(ctx, { retain_max: 3, sort: 'number_asc' });
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(meta.slice_sort).toBe('number_asc');
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
    expect(caps.open_pull_list.total_count_source).toBe('search_api');
    expect(caps.open_pull_list.default_slice_sort).toBe('number_asc');
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
