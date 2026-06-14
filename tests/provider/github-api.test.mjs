import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forgePacket, PACKET_TYPES } from '@remogram/core';
import {
  provider,
  apiBase,
  repoApiPath,
  summarizeChecks,
  mergeability,
  graphqlEndpoint,
  graphqlPullToRestShape,
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
      'head_sha',
      'statuses',
    ]);
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

  it('providerCapabilities reports supported pagination', () => {
    const caps = provider.providerCapabilities();
    expect(caps.pagination).toBe('supported');
    expect(caps.forge_ingest_cap_bytes).toBe(8192);
    expect(caps.check_pagination).toEqual({
      strategy: 'link_header',
      page_size: 25,
      max_pages: 50,
      page_size_param: 'per_page',
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
