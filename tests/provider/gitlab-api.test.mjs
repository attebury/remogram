import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forgePacket, PACKET_TYPES, DEFAULT_CHECK_STATUS_PAGE_SIZE, MAX_CHECK_STATUS_PAGES, MAX_OPEN_PULL_IDEMPOTENCY_PAGES } from '@remogram/core';
import {
  provider,
  apiBase,
  projectApiPath,
  projectId,
  summarizeChecks,
  mergeability,
  listOpenPullsWithMeta,
} from '@remogram/provider-gitlab-api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, '../fixtures/gitlab-api');

function load(name) {
  return JSON.parse(readFileSync(join(fixtures, name), 'utf8'));
}

function jsonResponse(body, status = 200, { headers = {} } = {}) {
  const headerMap = new Map(Object.entries(headers));
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

const ctx = {
  config: {
    provider: 'gitlab-api',
    owner: 'owner',
    repo: 'repo',
    baseUrl: 'https://gitlab.com',
    remote: 'origin',
    write_commands: ['status_set'],
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
    expect(body.write_support).toBe(true);
    expect(body.write_commands).toEqual(['status_set']);
    expect(body.idempotency_scan).toEqual({
      max_pages: 50,
      page_size: 25,
      ingest_backoff: 'halve_until_fit',
    });
    expect(body.forge_ingest_cap_bytes).toBe(8192);
    expect(body.pagination).toBe('supported');
    expect(body.check_pagination.check_source_count).toBe(body.check_sources.length);
    expect(body.check_pagination).toEqual({
      strategy: 'offset_limit',
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
    expect(body.capabilities).toContain('status_set');
    expect(body.capabilities).toContain('whoami');
    expect(global.fetch.mock.calls[0][0]).toBe('https://gitlab.com/api/v4/projects/owner%2Frepo');
    expect(global.fetch.mock.calls[0][1].headers['PRIVATE-TOKEN']).toBe('test-token');
  });

  it('whoami normalizes GitLab user and PAT self signals', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(load('user.json')))
      .mockResolvedValueOnce(jsonResponse(load('pat-self.json')));
    const body = await provider.whoami(ctx);
    expect(body.login).toBe('gitlab-agent');
    expect(body.can_write).toBe(true);
    expect(body.token_scope_signal.implemented).toBe(true);
    expect(body.token_expiry_signal.implemented).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe('https://gitlab.com/api/v4/user');
    expect(global.fetch.mock.calls[1][0]).toBe('https://gitlab.com/api/v4/personal_access_tokens/self');
  });

  it('whoami reports unimplemented PAT signals when self endpoint fails', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(load('user.json')))
      .mockRejectedValueOnce(new Error('404'));
    const body = await provider.whoami(ctx);
    expect(body.login).toBe('gitlab-agent');
    expect(body.token_scope_signal.implemented).toBe(false);
    expect(body.token_expiry_signal.implemented).toBe(false);
  });

  it('branchProtection normalizes GitLab protected branch and approval rules', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(load('protected-branch-main.json')))
      .mockResolvedValueOnce(jsonResponse(load('approval-rules-main.json')));
    const body = await provider.branchProtection(ctx, { branchRef: 'main' });
    expect(body.branch_ref).toBe('main');
    expect(body.protected_branch_rules).toEqual([{ name: 'main' }]);
    expect(body.approvals_required).toEqual({ implemented: true, count: 2 });
    expect(global.fetch.mock.calls[0][0]).toBe(
      'https://gitlab.com/api/v4/projects/owner%2Frepo/protected_branches/main',
    );
    expect(global.fetch.mock.calls[1][0]).toBe(
      'https://gitlab.com/api/v4/projects/owner%2Frepo/approval_rules',
    );
  });

  it('branchProtection returns empty policy when branch is unprotected (404)', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ message: '404 Not Found' }, 404));
    const body = await provider.branchProtection(ctx, { branchRef: 'main' });
    expect(body.protected_branch_rules).toEqual([]);
    expect(body.approvals_required).toEqual({ implemented: false, count: null });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('crFiles normalizes GitLab merge request changes', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(load('mr-changes.json')));
    const body = await provider.crFiles(ctx, { number: 42 });
    expect(body.pr_number).toBe(42);
    expect(body.changed_paths).toEqual(['README.md', 'packages/remogram-core/bar.js']);
    expect(global.fetch.mock.calls[0][0]).toBe(
      'https://gitlab.com/api/v4/projects/owner%2Frepo/merge_requests/42/changes',
    );
  });

  it('crComments normalizes GitLab merge request discussions', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(load('mr-discussions.json')));
    const body = await provider.crComments(ctx, { number: 42 });
    expect(body.pr_number).toBe(42);
    expect(body.comments).toHaveLength(2);
    expect(body.comments[0]).toMatchObject({
      id: '201',
      author: 'reviewer',
      path: 'packages/remogram-core/cr-comments.js',
      line: 15,
      resolved: false,
    });
    expect(body.comments[1].author).not.toContain('\n');
    expect(body.comments[1].body).not.toContain('glpat-');
    expect(body.comments[1].body).toContain('[REDACTED]');
    expect(body.comments[1].resolved).toBe(true);
    expect(body.comments_truncated).toBe(false);
    expect(global.fetch.mock.calls[0][0]).toMatch(
      /merge_requests\/42\/discussions\?per_page=\d+&page=1$/,
    );
  });

  const STATUS_SHA = 'cccccccccccccccccccccccccccccccccccccccc';

  it('statusSet POSTs commit status and maps GitLab name/status fields', async () => {
    process.env.GITLAB_TOKEN = 'test-token';
    const fixture = load('status-set-post.json');
    global.fetch.mockResolvedValueOnce(jsonResponse([]));
    global.fetch.mockResolvedValueOnce(jsonResponse(fixture, 201));
    const body = await provider.statusSet(ctx, {
      sha: STATUS_SHA,
      context: 'verify/wave1',
      state: 'success',
      description: 'Verification passed',
      target_url: 'https://gitlab.com/owner/repo/-/pipelines/1',
    });
    expect(body.sha).toBe(STATUS_SHA);
    expect(body.context).toBe('verify/wave1');
    expect(body.state).toBe('success');
    expect(body.description).toBe('Verification passed');
    expect(global.fetch.mock.calls[1][1]?.method).toBe('POST');
    const postBody = JSON.parse(global.fetch.mock.calls[1][1]?.body);
    expect(postBody).toMatchObject({
      state: 'success',
      name: 'verify/wave1',
      description: 'Verification passed',
      target_url: 'https://gitlab.com/owner/repo/-/pipelines/1',
    });
    expect(global.fetch.mock.calls[0][0]).toMatch(
      /repository\/commits\/cccccccccccccccccccccccccccccccccccccccc\/statuses\?per_page=\d+&page=1$/,
    );
    expect(global.fetch.mock.calls[1][0]).toMatch(
      /projects\/owner%2Frepo\/statuses\/cccccccccccccccccccccccccccccccccccccccc$/,
    );
  });

  it('statusSet returns reused_existing without POST when name and state match', async () => {
    process.env.GITLAB_TOKEN = 'test-token';
    global.fetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 7,
          name: 'verify/wave1',
          status: 'success',
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

  it('statusSet POSTs overwrite when existing GitLab status is unmapped skipped state', async () => {
    process.env.GITLAB_TOKEN = 'test-token';
    global.fetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 9,
          name: 'verify/wave1',
          status: 'skipped',
          updated_at: '2026-06-15T00:00:00Z',
        },
      ]),
    );
    global.fetch.mockResolvedValueOnce(
      jsonResponse({
        id: 10,
        status: 'success',
        name: 'verify/wave1',
      }, 201),
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

  it('statusSet reuses existing failed status when requested state is error', async () => {
    process.env.GITLAB_TOKEN = 'test-token';
    global.fetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 11,
          name: 'verify/wave1',
          status: 'failed',
          updated_at: '2026-06-15T00:00:00Z',
        },
      ]),
    );
    const body = await provider.statusSet(ctx, {
      sha: STATUS_SHA,
      context: 'verify/wave1',
      state: 'error',
    });
    expect(body.reused_existing).toBe(true);
    expect(body.state).toBe('failure');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('statusSet maps failure to GitLab failed on POST', async () => {
    process.env.GITLAB_TOKEN = 'test-token';
    global.fetch.mockResolvedValueOnce(jsonResponse([]));
    global.fetch.mockResolvedValueOnce(
      jsonResponse({
        id: 8,
        status: 'failed',
        name: 'verify/wave1',
      }, 201),
    );
    const body = await provider.statusSet(ctx, {
      sha: STATUS_SHA,
      context: 'verify/wave1',
      state: 'failure',
    });
    expect(body.state).toBe('failure');
    const postBody = JSON.parse(global.fetch.mock.calls[1][1]?.body);
    expect(postBody.state).toBe('failed');
  });

  it('statusSet POSTs overwrite when existing GitLab state differs', async () => {
    process.env.GITLAB_TOKEN = 'test-token';
    global.fetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 12,
          name: 'verify/wave1',
          status: 'success',
          updated_at: '2026-06-15T00:00:00Z',
        },
      ]),
    );
    global.fetch.mockResolvedValueOnce(
      jsonResponse({ id: 13, status: 'failed', name: 'verify/wave1' }, 201),
    );
    const body = await provider.statusSet(ctx, {
      sha: STATUS_SHA,
      context: 'verify/wave1',
      state: 'failure',
    });
    expect(body.state).toBe('failure');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][1]?.method).toBe('POST');
  });

  it('statusSet reuses latest matching name by updated_at order', async () => {
    process.env.GITLAB_TOKEN = 'test-token';
    global.fetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 14,
          name: 'verify/wave1',
          status: 'success',
          description: 'older',
          updated_at: '2026-06-14T00:00:00Z',
        },
        {
          id: 15,
          name: 'verify/wave1',
          status: 'success',
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
    process.env.GITLAB_TOKEN = 'test-token';
    const fullPage = Array.from({ length: DEFAULT_CHECK_STATUS_PAGE_SIZE }, (_, i) => ({
      id: i + 1,
      name: `other/${i}`,
      status: 'success',
    }));
    for (let page = 1; page <= MAX_OPEN_PULL_IDEMPOTENCY_PAGES; page += 1) {
      global.fetch.mockResolvedValueOnce(jsonResponse(fullPage));
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
  });

  it('forgeChanges normalizes GitLab merge request activity since boundary', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(load('mr-list-since-window.json')))
      .mockResolvedValueOnce(jsonResponse(load('merge-request-clean.json')))
      .mockResolvedValueOnce(jsonResponse(load('statuses-success.json')))
      .mockResolvedValueOnce(jsonResponse(load('pipelines-success.json')))
      .mockResolvedValueOnce(jsonResponse(load('merge-request-clean.json')))
      .mockResolvedValueOnce(jsonResponse(load('statuses-success.json')))
      .mockResolvedValueOnce(jsonResponse(load('pipelines-success.json')));
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
      /merge_requests\?state=all&order_by=updated_at&sort=desc&per_page=\d+&page=1$/,
    );
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

  it('prChecks carries reduced per_page to page 2 after oversized page 1', async () => {
    const paddedStatuses = Array.from({ length: 25 }, (_, i) => ({
      name: `ci/pad-${i}`,
      status: 'success',
      description: 'z'.repeat(400),
    }));
    const oversizedJson = JSON.stringify(paddedStatuses);
    const page2Status = [{ name: 'ci/page2', status: 'success', description: 'ok' }];

    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('merge_requests/42')) {
        return Promise.resolve(jsonResponse(load('merge-request-clean.json')));
      }
      if (href.includes('/pipelines')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (href.includes('/statuses')) {
        const parsed = new URL(href);
        const perPage = Number(parsed.searchParams.get('per_page') || '25');
        const page = Number(parsed.searchParams.get('page') || '1');
        if (page === 1 && perPage > 12) {
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
        if (page === 1) {
          return Promise.resolve(jsonResponse(paddedStatuses.slice(0, 12)));
        }
        if (page === 2) {
          expect(perPage).toBe(12);
          return Promise.resolve(jsonResponse(page2Status));
        }
        return Promise.resolve(jsonResponse([]));
      }
      return Promise.reject(new Error(`unexpected fetch: ${href}`));
    });

    const body = await provider.prChecks(ctx, { number: 42 });
    expect(body.check_conclusion).toBe('success');
    expect(global.fetch.mock.calls.some(([u]) => {
      const href = String(u);
      return href.includes('/statuses') && href.includes('page=2') && href.includes('per_page=12');
    })).toBe(true);
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

  it('mergePlan blocks on paths_truncated with allowed_paths', async () => {
    const manyChanges = Array.from({ length: 257 }, (_, i) => ({
      new_path: `p/f${i}.js`,
    }));
    global.fetch
      .mockResolvedValueOnce(jsonResponse(load('merge-request-clean.json')))
      .mockResolvedValueOnce(jsonResponse(load('merge-request-clean.json')))
      .mockResolvedValueOnce(jsonResponse(load('statuses-success.json')))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ changes: manyChanges }));
    const body = await provider.mergePlan(ctx, {
      number: 42,
      allowed_paths: ['p/**'],
    });
    expect(body.blockers).toContain('changed_paths_unavailable');
  });

  it('mergePlan passes in-scope allowlist with complete forge paths', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(load('merge-request-clean.json')))
      .mockResolvedValueOnce(jsonResponse(load('merge-request-clean.json')))
      .mockResolvedValueOnce(jsonResponse(load('statuses-success.json')))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(load('mr-changes.json')));
    const body = await provider.mergePlan(ctx, {
      number: 42,
      allowed_paths: ['packages/**', 'README.md'],
    });
    expect(body.blockers).not.toContain('changed_paths_unavailable');
    expect(body.blockers).not.toContain('path_scope_violation');
  });

  it('mergePlan rethrows unauthenticated when allowlist set without token', async () => {
    delete process.env.GITLAB_TOKEN;
    await expect(
      provider.mergePlan(ctx, { number: 42, allowed_paths: ['packages/**'] }),
    ).rejects.toMatchObject({
      forgeError: { code: 'unauthenticated_provider' },
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

  it('prChecks sets checks_truncated when pipelines stream hits max_pages', async () => {
    const fullPage = Array.from({ length: DEFAULT_CHECK_STATUS_PAGE_SIZE }, (_, i) => ({
      id: i + 1,
      status: 'success',
      name: `pipe-${i}`,
    }));
    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('merge_requests/42')) {
        return Promise.resolve(jsonResponse(load('merge-request-clean.json')));
      }
      if (href.includes('/statuses')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (href.includes('/pipelines')) {
        return Promise.resolve(jsonResponse(fullPage));
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

  it('mergePlan adds checks_incomplete when pipelines enumeration truncates', async () => {
    const fullPage = Array.from({ length: DEFAULT_CHECK_STATUS_PAGE_SIZE }, (_, i) => ({
      id: i + 1,
      status: 'success',
      name: `pipe-${i}`,
    }));
    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('merge_requests/42')) {
        return Promise.resolve(jsonResponse(load('merge-request-clean.json')));
      }
      if (href.includes('/statuses')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (href.includes('/pipelines')) {
        return Promise.resolve(jsonResponse(fullPage));
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

  it('listOpenPullsWithMeta survives oversized open MR list via ingest backoff', async () => {
    const paddedMrs = Array.from({ length: 25 }, (_, i) => ({
      iid: i + 1,
      title: 'z'.repeat(400),
    }));
    const oversizedJson = JSON.stringify(paddedMrs);
    expect(Buffer.byteLength(oversizedJson, 'utf8')).toBeGreaterThan(8192);

    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (!href.includes('/merge_requests')) {
        return Promise.reject(new Error(`unexpected fetch: ${href}`));
      }
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
      return Promise.resolve(jsonResponse([{ iid: 1 }]));
    });

    const meta = await listOpenPullsWithMeta(ctx, {});
    expect(meta.numbers).toEqual([1]);
    expect(meta.list_truncated).toBe(false);
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('per_page=12'))).toBe(true);
  });

  it('listOpenPullsWithMeta carries reduced per_page to page 2 after oversized page 1', async () => {
    const paddedMrs = Array.from({ length: 25 }, (_, i) => ({
      iid: i + 1,
      title: 'z'.repeat(400),
    }));
    const oversizedJson = JSON.stringify(paddedMrs);
    const page2Mr = [{ iid: 26 }];

    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (!href.includes('/merge_requests')) {
        return Promise.reject(new Error(`unexpected fetch: ${href}`));
      }
      const parsed = new URL(href);
      const perPage = Number(parsed.searchParams.get('per_page') || '25');
      const page = Number(parsed.searchParams.get('page') || '1');
      if (page === 1 && perPage > 12) {
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
      if (page === 1) {
        return Promise.resolve(jsonResponse(paddedMrs.slice(0, 12)));
      }
      if (page === 2) {
        expect(perPage).toBe(12);
        return Promise.resolve(jsonResponse(page2Mr));
      }
      return Promise.resolve(jsonResponse([]));
    });

    const meta = await listOpenPullsWithMeta(ctx, {});
    expect(meta.numbers).toContain(26);
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('page=2') && String(u).includes('per_page=12'))).toBe(true);
  });

  it('listOpenPullsWithMeta fast path uses X-Total with retain_max', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonResponse(
        [
          { iid: 30, state: 'opened' },
          { iid: 10, state: 'opened' },
        ],
        200,
        { headers: { 'X-Total': '2' } },
      ),
    );
    const meta = await listOpenPullsWithMeta(ctx, { retain_max: 2, sort: 'recent_update' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String(global.fetch.mock.calls[0][0])).toContain('order_by=updated_at');
    expect(meta.entry_count).toBe(2);
    expect(meta.list_truncated).toBe(false);
    expect(meta.slice_sort).toBe('recent_update');
  });

  it('listOpenPullsWithMeta falls back when body shorter than min(total, limit)', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonResponse([{ iid: 1, state: 'opened' }], 200, { headers: { 'X-Total': '5' } }),
    );
    global.fetch.mockResolvedValueOnce(jsonResponse([]));
    const meta = await listOpenPullsWithMeta(ctx, { retain_max: 3 });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(String(global.fetch.mock.calls[1][0])).toContain('page=2');
    expect(meta.numbers).toEqual([1]);
    expect(meta.entry_count).toBe(5);
    expect(meta.list_truncated).toBe(true);
  });

  it('listOpenPullsWithMeta number_asc full-collects when total exceeds retain_max', async () => {
    const allMrs = [
      { iid: 30, state: 'opened' },
      { iid: 10, state: 'opened' },
      { iid: 20, state: 'opened' },
      { iid: 5, state: 'opened' },
      { iid: 1, state: 'opened' },
      { iid: 7, state: 'opened' },
      { iid: 8, state: 'opened' },
      { iid: 9, state: 'opened' },
      { iid: 2, state: 'opened' },
      { iid: 3, state: 'opened' },
    ];
    global.fetch.mockResolvedValueOnce(
      jsonResponse(allMrs.slice(0, 3), 200, { headers: { 'X-Total': '10' } }),
    );
    global.fetch.mockResolvedValueOnce(jsonResponse(allMrs.slice(3, 6)));
    global.fetch.mockResolvedValueOnce(jsonResponse(allMrs.slice(6, 9)));
    global.fetch.mockResolvedValueOnce(jsonResponse(allMrs.slice(9)));
    const meta = await listOpenPullsWithMeta(ctx, { retain_max: 3, sort: 'number_asc' });
    expect(global.fetch).toHaveBeenCalledTimes(4);
    expect(meta.entry_count).toBe(10);
    expect(meta.numbers).toEqual([1, 2, 3]);
  });

  it('listOpenPullsWithMeta skips fast path for number_asc when total exceeds retain_max', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonResponse(
        [
          { iid: 30, state: 'opened' },
          { iid: 10, state: 'opened' },
          { iid: 20, state: 'opened' },
        ],
        200,
        { headers: { 'X-Total': '10' } },
      ),
    );
    global.fetch.mockResolvedValueOnce(jsonResponse([]));
    const meta = await listOpenPullsWithMeta(ctx, { retain_max: 3, sort: 'number_asc' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(meta.slice_sort).toBe('number_asc');
  });

  it('listOpenPullsWithMeta sets list_truncated at maxPages when limit exceeds fetch window', async () => {
    for (let page = 1; page <= MAX_CHECK_STATUS_PAGES; page += 1) {
      const start = (page - 1) * 100 + 1;
      global.fetch.mockResolvedValueOnce(
        jsonResponse(Array.from({ length: 100 }, (_, i) => ({ iid: start + i }))),
      );
    }
    const meta = await listOpenPullsWithMeta(ctx, { limit: 6000 });
    expect(meta.list_truncated).toBe(true);
    expect(meta.numbers).toHaveLength(5000);
  });
});
