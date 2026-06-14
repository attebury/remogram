import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forgePacket, PACKET_TYPES, DEFAULT_CHECK_STATUS_PAGE_SIZE, MAX_CHECK_STATUS_PAGES } from '@remogram/core';
import {
  provider,
  apiBase,
  projectApiPath,
  projectId,
  summarizeChecks,
  mergeability,
} from '@remogram/provider-gitlab-api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, '../fixtures/gitlab-api');

function load(name) {
  return JSON.parse(readFileSync(join(fixtures, name), 'utf8'));
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    body: {
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify(body));
      },
    },
  };
}

const ctx = {
  config: {
    provider: 'gitlab-api',
    owner: 'owner',
    repo: 'repo',
    baseUrl: 'https://gitlab.com',
    remote: 'origin',
  },
  cwd: process.cwd(),
  parsed: { owner: 'owner', repo: 'repo', host: 'gitlab.com' },
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
  providerId: 'gitlab-api',
  remoteName: 'origin',
  repoId: 'owner/repo',
};

function bodyKeys(packet) {
  return Object.keys(packet).filter((k) => !ENVELOPE_KEYS.includes(k)).sort();
}

describe('gitlab API path helpers', () => {
  it('encodes namespace/project as a GitLab project id', () => {
    expect(projectId({ owner: 'owner', repo: 'repo' })).toBe('owner%2Frepo');
    expect(projectApiPath({ owner: 'owner', repo: 'repo' }, 'merge_requests', 42)).toBe(
      '/projects/owner%2Frepo/merge_requests/42',
    );
  });
});

describe('apiBase', () => {
  it('binds public GitLab to gitlab.com API v4', () => {
    expect(apiBase(ctx.config, ctx.parsed)).toBe('https://gitlab.com/api/v4');
  });

  it('rejects public GitLab configured with another API host', () => {
    expect(() =>
      apiBase({ ...ctx.config, baseUrl: 'https://evil.example' }, ctx.parsed),
    ).toThrow(/gitlab\.com remotes/);
  });

  it('derives self-managed GitLab API from the verified remote host', () => {
    expect(
      apiBase(
        { ...ctx.config, baseUrl: 'https://git.example.test' },
        { ...ctx.parsed, host: 'git.example.test' },
      ),
    ).toBe('https://git.example.test/api/v4');
  });

  it('rejects self-managed GitLab API host mismatches before token use', () => {
    expect(() =>
      apiBase(
        { ...ctx.config, baseUrl: 'https://evil.example.test' },
        { ...ctx.parsed, host: 'git.example.test' },
      ),
    ).toThrow(/must match remote host git\.example\.test/);
  });
});

describe('provider-gitlab-api fixtures', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.GITLAB_TOKEN = 'test-token';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GITLAB_TOKEN;
  });

  it('providerCapabilities returns structured facts', () => {
    const body = provider.providerCapabilities(ctx);
    expect(body.auth_envs).toEqual(['GITLAB_TOKEN']);
    expect(body.check_sources).toEqual(['commit_statuses', 'pipelines']);
    expect(body.write_support).toBe(false);
    expect(body.forge_ingest_cap_bytes).toBe(8192);
    expect(body.pagination).toBe('supported');
    expect(body.check_pagination).toEqual({
      strategy: 'offset_limit',
      page_size: 25,
      max_pages: 50,
      page_size_param: 'per_page',
      ingest_backoff: 'halve_until_fit',
      on_page_cap: 'set_checks_truncated',
      compliant_max_items_per_source: 1250,
      truncation_packet_field: 'checks_truncated',
    });
  });

  it('repoStatus returns gated capabilities without token', async () => {
    delete process.env.GITLAB_TOKEN;
    const body = await provider.repoStatus(ctx);
    expect(body.auth_present).toBe(false);
    expect(body.auth_env).toBeNull();
    expect(body.capabilities).toEqual(['repo_status']);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('repoStatus returns all capabilities with token', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(load('repo.json')));
    const body = await provider.repoStatus(ctx);
    expect(body.auth_present).toBe(true);
    expect(body.auth_env).toBe('GITLAB_TOKEN');
    expect(body.default_branch).toBe('main');
    expect(body.capabilities).toContain('pr_status');
    expect(global.fetch.mock.calls[0][0]).toBe('https://gitlab.com/api/v4/projects/owner%2Frepo');
    expect(global.fetch.mock.calls[0][1].headers['PRIVATE-TOKEN']).toBe('test-token');
  });

  it('authenticated commands fail closed before fetch when token is missing', async () => {
    delete process.env.GITLAB_TOKEN;
    await expect(provider.prView(ctx, { number: 42 })).rejects.toMatchObject({
      forgeError: { code: 'unauthenticated_provider' },
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refsCompare resolves local refs and preserves shared packet body keys', async () => {
    const body = await provider.refsCompare(ctx, 'HEAD', 'HEAD');
    expect(body.base_ref).toBe('HEAD');
    expect(body.head_ref).toBe('HEAD');
    expect(body.base_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(body.head_sha).toBe(body.base_sha);
    expect(bodyKeys(forgePacket(PACKET_TYPES.REF_COMPARE, packetCtx, body))).toEqual([
      'ahead_by',
      'base_ref',
      'base_sha',
      'behind_by',
      'head_ref',
      'head_sha',
    ]);
  });

  it('prView maps GitLab MR fields to shared PR status shape', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(load('merge-request-clean.json')));
    const body = await provider.prView(ctx, { number: 42 });
    expect(body.pr_number).toBe(42);
    expect(body.state).toBe('open');
    expect(body.mergeability).toBe('clean');
    expect(body.title).toBe('Add GitLab provider with newline');
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

  it('maps conflicted merge status to conflicted', () => {
    expect(mergeability(load('merge-request-conflicted.json'))).toBe('conflicted');
  });

  it('prChecks rejects option injection ref', async () => {
    await expect(provider.prChecks(ctx, { ref: '--show-toplevel' })).rejects.toMatchObject({
      forgeError: { code: 'invalid_args' },
    });
  });

  it('prChecks maps statuses plus pipelines to success conclusion', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(load('merge-request-clean.json')))
      .mockResolvedValueOnce(jsonResponse(load('statuses-success.json')))
      .mockResolvedValueOnce(jsonResponse(load('pipelines-success.json')));
    const body = await provider.prChecks(ctx, { number: 42 });
    expect(body.check_conclusion).toBe('success');
    expect(body.statuses).toEqual([
      { context: 'ci/status', state: 'success', description: 'status ok' },
      { context: 'ci/pipeline', state: 'success', description: 'success' },
    ]);
    expect(bodyKeys(forgePacket(PACKET_TYPES.PR_CHECKS, packetCtx, body))).toEqual([
      'check_conclusion',
      'checks_truncated',
      'head_sha',
      'statuses',
    ]);
  });

  it('summarizes missing, pending, failure, and unknown checks', () => {
    expect(summarizeChecks([])).toBe('missing');
    expect(summarizeChecks([{ state: 'pending' }])).toBe('pending');
    expect(summarizeChecks([{ state: 'failure' }, { state: 'success' }])).toBe('failure');
    expect(summarizeChecks([{ state: 'success' }, { state: 'unknown' }])).toBe('unknown');
  });

  it('prChecks includes checks_failed when commit statuses fail on page 2', async () => {
    const page1Statuses = Array.from({ length: DEFAULT_CHECK_STATUS_PAGE_SIZE }, (_, i) => ({
      name: `ci/page1-${i}`,
      status: 'success',
      description: 'ok',
    }));
    const page2Statuses = [{ name: 'ci/page2-fail', status: 'failed', description: 'fail' }];
    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('merge_requests/42')) {
        return Promise.resolve(jsonResponse(load('merge-request-clean.json')));
      }
      if (href.includes('/statuses') && href.includes('page=2')) {
        return Promise.resolve(jsonResponse(page2Statuses));
      }
      if (href.includes('/statuses')) {
        return Promise.resolve(jsonResponse(page1Statuses));
      }
      if (href.includes('/pipelines')) {
        return Promise.resolve(jsonResponse([]));
      }
      return Promise.reject(new Error(`unexpected fetch: ${href}`));
    });
    const body = await provider.prChecks(ctx, { number: 42 });
    expect(body.check_conclusion).toBe('failure');
    const statusUrls = global.fetch.mock.calls.map(([u]) => String(u));
    expect(statusUrls.some((u) => u.includes(`per_page=${DEFAULT_CHECK_STATUS_PAGE_SIZE}`))).toBe(true);
    expect(statusUrls.some((u) => u.includes('/statuses') && u.includes('page=2'))).toBe(true);
  });

  it('prChecks survives oversized status page via ingest backoff', async () => {
    const paddedStatuses = Array.from({ length: 25 }, (_, i) => ({
      name: `ci/pad-${i}`,
      status: 'success',
      description: 'z'.repeat(400),
    }));
    const oversizedJson = JSON.stringify(paddedStatuses);
    expect(Buffer.byteLength(oversizedJson, 'utf8')).toBeGreaterThan(8192);

    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('merge_requests/42')) {
        return Promise.resolve(jsonResponse(load('merge-request-clean.json')));
      }
      if (href.includes('/pipelines')) {
        return Promise.resolve(jsonResponse([]));
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
          jsonResponse([{ name: 'ci/ok', status: 'success', description: 'ok' }]),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${href}`));
    });

    const body = await provider.prChecks(ctx, { number: 42 });
    expect(body.check_conclusion).toBe('success');
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('per_page=12'))).toBe(true);
  });

  it('mergePlan includes checks_failed when page 1 returns 100 statuses', async () => {
    const legacyPage1 = Array.from({ length: 100 }, (_, i) => ({
      name: `ci/legacy-${i}`,
      status: 'success',
      description: 'ok',
    }));
    const page2Statuses = [{ name: 'ci/page2-fail', status: 'failed', description: 'fail' }];
    global.fetch
      .mockResolvedValueOnce(jsonResponse(load('merge-request-clean.json')))
      .mockResolvedValueOnce(jsonResponse(load('merge-request-clean.json')))
      .mockResolvedValueOnce(jsonResponse(legacyPage1))
      .mockResolvedValueOnce(jsonResponse(page2Statuses))
      .mockResolvedValueOnce(jsonResponse([]));
    const body = await provider.mergePlan(ctx, { number: 42 });
    expect(body.checks_conclusion).toBe('failure');
    expect(body.blockers).toContain('checks_failed');
  });

  it('mergePlan includes checks_failed when commit statuses fail on page 2', async () => {
    const page1Statuses = Array.from({ length: DEFAULT_CHECK_STATUS_PAGE_SIZE }, (_, i) => ({
      name: `ci/page1-${i}`,
      status: 'success',
      description: 'ok',
    }));
    const page2Statuses = [{ name: 'ci/page2-fail', status: 'failed', description: 'fail' }];
    global.fetch
      .mockResolvedValueOnce(jsonResponse(load('merge-request-clean.json')))
      .mockResolvedValueOnce(jsonResponse(load('merge-request-clean.json')))
      .mockResolvedValueOnce(jsonResponse(page1Statuses))
      .mockResolvedValueOnce(jsonResponse(page2Statuses))
      .mockResolvedValueOnce(jsonResponse([]));
    const body = await provider.mergePlan(ctx, { number: 42 });
    expect(body.checks_conclusion).toBe('failure');
    expect(body.blockers).toContain('checks_failed');
  });

  it('mergePlan uses the shared blocker vocabulary', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(load('merge-request-conflicted.json')))
      .mockResolvedValueOnce(jsonResponse(load('merge-request-conflicted.json')))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]));
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

  it('prChecks sets checks_truncated when status pages hit max_pages', async () => {
    const fullPage = Array.from({ length: DEFAULT_CHECK_STATUS_PAGE_SIZE }, (_, i) => ({
      name: `ci/cap-${i}`,
      status: 'success',
      description: 'ok',
    }));
    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('merge_requests/42')) {
        return Promise.resolve(jsonResponse(load('merge-request-clean.json')));
      }
      if (href.includes('/statuses')) {
        return Promise.resolve(jsonResponse(fullPage));
      }
      if (href.includes('/pipelines')) {
        return Promise.resolve(jsonResponse([]));
      }
      return Promise.reject(new Error(`unexpected fetch: ${href}`));
    });
    const body = await provider.prChecks(ctx, { number: 42 });
    expect(body.checks_truncated).toBe(true);
    expect(body.statuses.length).toBe(DEFAULT_CHECK_STATUS_PAGE_SIZE * MAX_CHECK_STATUS_PAGES);
  });

  it('mergePlan adds checks_incomplete when check enumeration truncates', async () => {
    const fullPage = Array.from({ length: DEFAULT_CHECK_STATUS_PAGE_SIZE }, (_, i) => ({
      name: `ci/cap-${i}`,
      status: 'success',
      description: 'ok',
    }));
    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('merge_requests/42')) {
        return Promise.resolve(jsonResponse(load('merge-request-clean.json')));
      }
      if (href.includes('/statuses')) {
        return Promise.resolve(jsonResponse(fullPage));
      }
      if (href.includes('/pipelines')) {
        return Promise.resolve(jsonResponse([]));
      }
      return Promise.reject(new Error(`unexpected fetch: ${href}`));
    });
    const body = await provider.mergePlan(ctx, { number: 42 });
    expect(body.checks_conclusion).toBe('success');
    expect(body.blockers).toContain('checks_incomplete');
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
