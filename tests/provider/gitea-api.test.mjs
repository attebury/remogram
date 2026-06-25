import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as giteaProvider from '@remogram/provider-gitea-api';
import * as giteaBranchProtection from '@remogram/provider-gitea-api/branch-protection-internal.js';
import { DEFAULT_CHECK_STATUS_PAGE_SIZE, MAX_CHECK_STATUS_PAGES, MAX_OPEN_PULL_IDEMPOTENCY_PAGES } from '@remogram/core';

const {
  provider,
  repoApiPath,
  repoApiPathFor,
  apiBase,
  normalizeGiteaStatusState,
  normalizeGiteaPrState,
  listOpenPullsWithMeta,
  crInventorySlice,
  dedupeGiteaStatusRecords,
  mapGiteaCommitStatuses,
  isGiteaHeadOutOfDate409,
  forgeSourceRepoIdFromPull,
} = giteaProvider;

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, '../fixtures/gitea-api');

function load(name) {
  return JSON.parse(readFileSync(join(fixtures, name), 'utf8'));
}

const ctx = {
  config: {
    provider: 'gitea-api',
    owner: 'attebury',
    repo: 'remogram',
    baseUrl: 'http://localhost:3000',
    remote: 'origin',
    write_commands: ['cr_open', 'status_set', 'merge', 'issue_open'],
  },
  cwd: process.cwd(),
  parsed: { owner: 'attebury', repo: 'remogram', host: 'localhost:3000' },
};

describe('repoApiPath', () => {
  it('encodes path segments', () => {
    expect(repoApiPath({ owner: 'a/b', repo: 'c' })).toContain(encodeURIComponent('a/b'));
  });
});

describe('apiBase', () => {
  it('binds self-hosted Gitea to verified remote host', () => {
    expect(
      apiBase(
        { ...ctx.config, baseUrl: 'http://localhost:3000' },
        ctx.parsed,
      ),
    ).toBe('http://localhost:3000/api/v1');
  });

  it('binds gitea.com to https://gitea.com/api/v1', () => {
    expect(
      apiBase(
        { ...ctx.config, baseUrl: 'https://gitea.com' },
        { ...ctx.parsed, host: 'gitea.com' },
      ),
    ).toBe('https://gitea.com/api/v1');
  });

  it('rejects gitea.com remote with mismatched baseUrl host', () => {
    expect(() =>
      apiBase(
        { ...ctx.config, baseUrl: 'https://evil.example' },
        { ...ctx.parsed, host: 'gitea.com' },
      ),
    ).toThrow(/gitea.com remotes/);
  });

  it('rejects self-hosted API host mismatch before token use', () => {
    expect(() =>
      apiBase(
        { ...ctx.config, baseUrl: 'https://evil.example.test' },
        { ...ctx.parsed, host: 'git.example.test' },
      ),
    ).toThrow(/must match remote host git\.example\.test/);
  });
});

describe('provider-gitea-api fixtures', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.GITEA_TOKEN = 'test-token';
    vi.spyOn(giteaBranchProtection, 'resolveBranchProtection').mockResolvedValue({
      branch_ref: 'main',
      required_status_contexts: [],
      protected_branch_rules: [],
      approvals_required: { implemented: false, count: null },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.GITEA_TOKEN;
  });

  it('repoStatus returns gated capabilities without token', async () => {
    delete process.env.GITEA_TOKEN;
    const body = await provider.repoStatus(ctx);
    expect(body.auth_present).toBe(false);
    expect(body.capabilities).toEqual(['repo_status']);
  });

  it('repoStatus returns all capabilities with token', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(JSON.stringify(load('repo.json')));
        },
      },
    });
    const body = await provider.repoStatus(ctx);
    expect(body.capabilities).toContain('pr_status');
    expect(body.integration_ref_hints).toEqual(
      expect.objectContaining({
        default_branch: expect.any(String),
      }),
    );
  });

  it('forgeChanges includes issue lifecycle events when include_issues is true', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from('[]');
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from(
              JSON.stringify([
                {
                  number: 514,
                  title: 'Issue opened',
                  html_url: 'http://localhost:3000/attebury/remogram/issues/514',
                  state: 'open',
                  created_at: '2024-06-02T10:00:00Z',
                  updated_at: '2024-06-02T10:00:00Z',
                },
              ]),
            );
          },
        },
      });
    const body = await provider.forgeChanges(ctx, {
      since: '2024-06-01T12:00:00Z',
      include_issues: true,
    });
    expect(body.events.some((event) => event.kind === 'issue_opened')).toBe(true);
  });

  it('prView strips bulky body fields under ingest cap (#478)', async () => {
    const hugeBody = 'x'.repeat(20_000);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(
            JSON.stringify({
              number: 1,
              title: 'historical',
              state: 'open',
              mergeable: true,
              html_url: 'http://localhost:3000/attebury/remogram/pulls/1',
              body: hugeBody,
              base: { ref: 'remo', sha: 'aaa111' },
              head: { ref: 'feature/x', sha: 'bbb222' },
            }),
          );
        },
      },
    });
    const body = await provider.prView(ctx, { number: 1 });
    expect(body.pr_number).toBe(1);
    expect(body.mergeability).toBe('clean');
  });

  it('prView maps mergeability by number', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(JSON.stringify(load('pull.json')));
        },
      },
    });
    const body = await provider.prView(ctx, { number: 1 });
    expect(body.pr_number).toBe(1);
    expect(body.mergeability).toBe('clean');
    expect(body.forge_source_repo_id).toBeUndefined();
  });

  it('prView includes forge_source_repo_id when head repo differs from configured repo', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(
            JSON.stringify({
              number: 2,
              title: 'fork pr',
              state: 'open',
              mergeable: true,
              html_url: 'http://localhost:3000/attebury/remogram/pulls/2',
              base: { ref: 'remo', sha: 'aaa111' },
              head: {
                ref: 'feature/x',
                sha: 'bbb222',
                repo: { name: 'fork', owner: { login: 'forker' } },
              },
            }),
          );
        },
      },
    });
    const body = await provider.prView(ctx, { number: 2 });
    expect(body.forge_source_repo_id).toBe('forker/fork');
  });

  it('forgeSourceRepoIdFromPull returns null for same-repo head', () => {
    expect(
      forgeSourceRepoIdFromPull(ctx.config, {
        head: { repo: { name: 'remogram', owner: { login: 'attebury' } } },
      }),
    ).toBeNull();
  });

  it('forgeSourceRepoIdFromPull returns null for same-repo head with case-insensitive match', () => {
    expect(
      forgeSourceRepoIdFromPull(ctx.config, {
        head: { repo: { name: 'Remogram', owner: { login: 'Attebury' } } },
      }),
    ).toBeNull();
  });

  it('prView omits forge_source_repo_id when pull head.repo is absent', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(JSON.stringify(load('pull.json')));
        },
      },
    });
    const body = await provider.prView(ctx, { number: 1 });
    expect(body.forge_source_repo_id).toBeUndefined();
  });

  it('prChecks requires resolvable ref', async () => {
    await expect(provider.prChecks(ctx, { ref: 'not-a-real-ref-xyz' })).rejects.toMatchObject({
      forgeError: { code: 'missing_ref' },
    });
  });

  it('prChecks rejects option injection ref', async () => {
    await expect(provider.prChecks(ctx, { ref: '--show-toplevel' })).rejects.toMatchObject({
      forgeError: { code: 'invalid_args' },
    });
  });

  it('prChecks maps statuses-success fixture to success conclusion', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from(JSON.stringify(load('pull.json')));
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from(JSON.stringify(load('statuses-success.json')));
          },
        },
      });
    const body = await provider.prChecks(ctx, { number: 1 });
    expect(body.check_conclusion).toBe('success');
    expect(body.statuses).toHaveLength(1);
    expect(body.statuses[0].context).toBe('ci/gate');
  });

  it('normalizes mixed-case Gitea status states before summarizeChecks', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from(JSON.stringify(load('pull.json')));
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from(
              JSON.stringify([
                {
                  context: 'ci/gate',
                  state: 'Success',
                  description: 'ok',
                },
              ]),
            );
          },
        },
      });
    const body = await provider.prChecks(ctx, { number: 1 });
    expect(body.check_conclusion).toBe('success');
    expect(body.statuses[0].state).toBe('success');
  });

  function mockPullAndStatuses(statusesFixture) {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from(JSON.stringify(load('pull.json')));
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from(JSON.stringify(load(statusesFixture)));
          },
        },
      });
  }

  it('prChecks maps Gitea status field when state is absent', async () => {
    mockPullAndStatuses('statuses-gitea-api-success.json');
    const body = await provider.prChecks(ctx, { number: 1 });
    expect(body.check_conclusion).toBe('success');
    expect(body.statuses).toHaveLength(1);
    expect(body.statuses[0].state).toBe('success');
  });

  it('prChecks dedupes duplicate contexts to the latest row', async () => {
    mockPullAndStatuses('statuses-duplicate-context.json');
    const body = await provider.prChecks(ctx, { number: 1 });
    expect(body.check_conclusion).toBe('success');
    expect(body.statuses).toHaveLength(1);
    expect(body.statuses[0].state).toBe('success');
  });

  it('prChecks keeps unknown status values fail-closed without throwing', async () => {
    mockPullAndStatuses('statuses-unknown-value.json');
    const body = await provider.prChecks(ctx, { number: 1 });
    expect(body.check_conclusion).toBe('unknown');
    expect(body.statuses).toHaveLength(1);
    expect(body.statuses[0].state).toBe('unknown');
  });

  it('dedupeGiteaStatusRecords prefers newer updated_at then higher id', () => {
    const deduped = dedupeGiteaStatusRecords(load('statuses-duplicate-context.json'));
    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe(2);
    expect(mapGiteaCommitStatuses(deduped)[0].state).toBe('success');
  });

  it('mergePlan treats Closed PR state as not open', async () => {
    const closedPull = {
      ...load('pull.json'),
      state: 'Closed',
    };
    const pullResponse = {
      ok: true,
      status: 200,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(JSON.stringify(closedPull));
        },
      },
    };
    global.fetch
      .mockResolvedValueOnce(pullResponse)
      .mockResolvedValueOnce(pullResponse)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from(JSON.stringify([]));
          },
        },
      });
    const body = await provider.mergePlan(ctx, { number: 1 });
    expect(body.blockers).toContain('pr_not_open');
  });

  it('normalizeGitea helpers map aliases', () => {
    expect(normalizeGiteaStatusState('Success')).toBe('success');
    expect(normalizeGiteaStatusState('ERROR')).toBe('failure');
    expect(normalizeGiteaPrState('Open')).toBe('open');
    expect(normalizeGiteaPrState('closed')).toBe('closed');
  });

  it('prChecks survives oversized status page via ingest backoff', async () => {
    const pull = load('pull.json');
    const pullResponse = jsonPageResponse(pull);
    const paddedStatuses = Array.from({ length: 25 }, (_, i) => ({
      context: `ci/pad-${i}`,
      state: 'success',
      description: 'z'.repeat(400),
    }));
    const oversizedJson = JSON.stringify(paddedStatuses);
    expect(Buffer.byteLength(oversizedJson, 'utf8')).toBeGreaterThan(8192);

    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('/pulls/1')) {
        return Promise.resolve(pullResponse);
      }
      const limitMatch = href.match(/[?&]limit=(\d+)/);
      const limit = limitMatch ? Number(limitMatch[1]) : 25;
      if (limit > 12) {
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
        jsonPageResponse([{ context: 'ci/ok', state: 'success', description: 'ok' }]),
      );
    });

    const body = await provider.prChecks(ctx, { number: 1 });
    expect(body.check_conclusion).toBe('success');
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('limit=12'))).toBe(true);
  });

  it('prChecks carries reduced limit to page 2 after oversized page 1', async () => {
    const pull = load('pull.json');
    const pullResponse = jsonPageResponse(pull);
    const paddedStatuses = Array.from({ length: 25 }, (_, i) => ({
      context: `ci/pad-${i}`,
      state: 'success',
      description: 'z'.repeat(400),
    }));
    const oversizedJson = JSON.stringify(paddedStatuses);
    const page2Status = [{ context: 'ci/page2', state: 'success', description: 'ok' }];

    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('/pulls/1')) {
        return Promise.resolve(pullResponse);
      }
      const limitMatch = href.match(/[?&]limit=(\d+)/);
      const pageMatch = href.match(/[?&]page=(\d+)/);
      const limit = limitMatch ? Number(limitMatch[1]) : 25;
      const page = pageMatch ? Number(pageMatch[1]) : 1;
      if (page === 1 && limit > 12) {
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
        return Promise.resolve(jsonPageResponse(paddedStatuses.slice(0, 12)));
      }
      if (page === 2) {
        expect(limit).toBe(12);
        return Promise.resolve(jsonPageResponse(page2Status));
      }
      return Promise.resolve(jsonPageResponse([]));
    });

    const body = await provider.prChecks(ctx, { number: 1 });
    expect(body.check_conclusion).toBe('success');
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('page=2') && String(u).includes('limit=12'))).toBe(true);
  });

  it('prChecks includes checks_failed when commit statuses fail on page 2', async () => {
    const pull = load('pull.json');
    const pullResponse = jsonPageResponse(pull);
    const page1Statuses = Array.from({ length: DEFAULT_CHECK_STATUS_PAGE_SIZE }, (_, i) => ({
      context: `ci/page1-${i}`,
      state: 'success',
      description: 'ok',
    }));
    const page2Statuses = [{ context: 'ci/page2-fail', state: 'failure', description: 'fail' }];
    global.fetch
      .mockResolvedValueOnce(pullResponse)
      .mockResolvedValueOnce(jsonPageResponse(page1Statuses))
      .mockResolvedValueOnce(jsonPageResponse(page2Statuses));
    const body = await provider.prChecks(ctx, { number: 1 });
    expect(body.check_conclusion).toBe('failure');
    const statusUrls = global.fetch.mock.calls.map(([u]) => String(u));
    expect(statusUrls.some((u) => u.includes(`limit=${DEFAULT_CHECK_STATUS_PAGE_SIZE}`))).toBe(true);
    expect(statusUrls.some((u) => u.includes('page=2'))).toBe(true);
  });

  it('mergePlan includes checks_failed when page 1 returns 100 statuses', async () => {
    const pull = load('pull.json');
    const pullResponse = jsonPageResponse(pull);
    const legacyPage1 = Array.from({ length: 100 }, (_, i) => ({
      context: `ci/legacy-${i}`,
      state: 'success',
      description: 'ok',
    }));
    const page2Statuses = [{ context: 'ci/page2-fail', state: 'failure', description: 'fail' }];
    global.fetch
      .mockResolvedValueOnce(pullResponse)
      .mockResolvedValueOnce(pullResponse)
      .mockResolvedValueOnce(jsonPageResponse(legacyPage1))
      .mockResolvedValueOnce(jsonPageResponse(page2Statuses));
    const body = await provider.mergePlan(ctx, { number: 1 });
    expect(body.checks_conclusion).toBe('failure');
    expect(body.blockers).toContain('checks_failed');
  });

  it('mergePlan includes checks_failed when commit statuses fail on page 2', async () => {
    const pull = load('pull.json');
    const pullResponse = jsonPageResponse(pull);
    const page1Statuses = Array.from({ length: DEFAULT_CHECK_STATUS_PAGE_SIZE }, (_, i) => ({
      context: `ci/page1-${i}`,
      state: 'success',
      description: 'ok',
    }));
    const page2Statuses = [{ context: 'ci/page2-fail', state: 'failure', description: 'fail' }];
    global.fetch
      .mockResolvedValueOnce(pullResponse)
      .mockResolvedValueOnce(pullResponse)
      .mockResolvedValueOnce(jsonPageResponse(page1Statuses))
      .mockResolvedValueOnce(jsonPageResponse(page2Statuses));
    const body = await provider.mergePlan(ctx, { number: 1 });
    expect(body.checks_conclusion).toBe('failure');
    expect(body.blockers).toContain('checks_failed');
  });

  it('prChecks sets checks_truncated when status pages hit max_pages', async () => {
    const pull = load('pull.json');
    const pullResponse = jsonPageResponse(pull);
    let statusPage = 0;
    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('/pulls/1')) {
        return Promise.resolve(pullResponse);
      }
      if (href.includes('/statuses')) {
        statusPage += 1;
        const fullPage = Array.from({ length: DEFAULT_CHECK_STATUS_PAGE_SIZE }, (_, i) => ({
          context: `ci/cap-${statusPage}-${i}`,
          state: 'success',
          description: 'ok',
        }));
        return Promise.resolve(jsonPageResponse(fullPage));
      }
      return Promise.reject(new Error(`unexpected fetch: ${href}`));
    });
    const body = await provider.prChecks(ctx, { number: 1 });
    expect(body.checks_truncated).toBe(true);
    expect(body.statuses.length).toBe(DEFAULT_CHECK_STATUS_PAGE_SIZE * MAX_CHECK_STATUS_PAGES);
  });

  it('mergePlan adds checks_incomplete when check enumeration truncates', async () => {
    const pull = load('pull.json');
    const pullResponse = jsonPageResponse(pull);
    const fullPage = Array.from({ length: DEFAULT_CHECK_STATUS_PAGE_SIZE }, (_, i) => ({
      context: `ci/cap-${i}`,
      state: 'success',
      description: 'ok',
    }));
    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('/pulls/1')) {
        return Promise.resolve(pullResponse);
      }
      if (href.includes('/statuses')) {
        return Promise.resolve(jsonPageResponse(fullPage));
      }
      return Promise.reject(new Error(`unexpected fetch: ${href}`));
    });
    const body = await provider.mergePlan(ctx, { number: 1 });
    expect(body.checks_conclusion).toBe('success');
    expect(body.blockers).toContain('checks_incomplete');
  });

  it('providerCapabilities reports supported pagination', () => {
    const caps = provider.providerCapabilities();
    expect(caps.pagination).toBe('supported');
    expect(caps.forge_ingest_cap_bytes).toBe(8192);
    expect(caps.check_pagination.check_source_count).toBe(caps.check_sources.length);
    expect(caps.check_pagination).toEqual({
      strategy: 'offset_limit',
      page_size: 25,
      max_pages: 50,
      page_size_param: 'limit',
      ingest_backoff: 'halve_until_fit',
      on_page_cap: 'set_checks_truncated',
      compliant_max_items_per_source: 1250,
      check_source_count: 1,
      truncation_combination: 'single_source',
      compliant_max_items_total: 1250,
      truncation_packet_field: 'checks_truncated',
    });
  });

  function jsonPageResponse(body, headers = {}) {
    return {
      ok: true,
      status: 200,
      headers: new Map(Object.entries(headers)),
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(JSON.stringify(body));
        },
      },
    };
  }

  function openPullPage(start) {
    return Array.from({ length: 100 }, (_, i) => ({ number: start + i, state: 'open' }));
  }

  it('listOpenPullsWithMeta survives oversized open PR list via ingest backoff', async () => {
    const paddedPulls = Array.from({ length: 25 }, (_, i) => ({
      number: i + 1,
      title: 'z'.repeat(400),
    }));
    const oversizedJson = JSON.stringify(paddedPulls);
    expect(Buffer.byteLength(oversizedJson, 'utf8')).toBeGreaterThan(8192);

    global.fetch.mockImplementation((url) => {
      const href = String(url);
      const limitMatch = href.match(/[?&]limit=(\d+)/);
      const limit = limitMatch ? Number(limitMatch[1]) : 25;
      if (limit > 12) {
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
      return Promise.resolve(jsonPageResponse([{ number: 1 }]));
    });

    const meta = await listOpenPullsWithMeta(ctx, {});
    expect(meta.numbers).toEqual([1]);
    expect(meta.list_truncated).toBe(false);
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('limit=12'))).toBe(true);
  });

  it('listOpenPullsWithMeta carries reduced limit to page 2 after oversized page 1', async () => {
    const paddedPulls = Array.from({ length: 25 }, (_, i) => ({
      number: i + 1,
      title: 'z'.repeat(400),
    }));
    const oversizedJson = JSON.stringify(paddedPulls);
    const page2Pull = [{ number: 26, state: 'open' }];

    global.fetch.mockImplementation((url) => {
      const href = String(url);
      if (!href.includes('/pulls') || href.includes('/pulls/')) {
        return Promise.reject(new Error(`unexpected fetch: ${href}`));
      }
      const limitMatch = href.match(/[?&]limit=(\d+)/);
      const pageMatch = href.match(/[?&]page=(\d+)/);
      const limit = limitMatch ? Number(limitMatch[1]) : 25;
      const page = pageMatch ? Number(pageMatch[1]) : 1;
      if (page === 1 && limit > 12) {
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
        return Promise.resolve(jsonPageResponse(paddedPulls.slice(0, 12)));
      }
      if (page === 2) {
        expect(limit).toBe(12);
        return Promise.resolve(jsonPageResponse(page2Pull));
      }
      return Promise.resolve(jsonPageResponse([]));
    });

    const meta = await listOpenPullsWithMeta(ctx, {});
    expect(meta.numbers).toContain(26);
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('page=2') && String(u).includes('limit=12'))).toBe(true);
  });

  it('listOpenPullsWithMeta honors list limit in HTTP query', async () => {
    global.fetch.mockResolvedValueOnce(jsonPageResponse([{ number: 1, state: 'open' }]));
    global.fetch.mockResolvedValueOnce(jsonPageResponse([]));
    const meta = await listOpenPullsWithMeta(ctx, { limit: 1 });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][0]).toContain('limit=1');
    expect(meta.numbers).toEqual([1]);
    expect(meta.list_truncated).toBe(false);
  });

  it('listOpenPullsWithMeta sets list_truncated false when open count equals list limit', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonPageResponse([
        { number: 33, state: 'open' },
        { number: 41, state: 'open' },
        { number: 43, state: 'open' },
      ]),
    );
    global.fetch.mockResolvedValueOnce(jsonPageResponse([]));
    const meta = await listOpenPullsWithMeta(ctx, { limit: 3 });
    expect(meta.numbers).toEqual([33, 41, 43]);
    expect(meta.list_truncated).toBe(false);
  });

  it('listOpenPullsWithMeta sets list_truncated false when open count equals maxPages window', async () => {
    for (let page = 1; page <= 50; page += 1) {
      global.fetch.mockResolvedValueOnce(jsonPageResponse(openPullPage((page - 1) * 100 + 1)));
    }
    global.fetch.mockResolvedValueOnce(jsonPageResponse([]));
    const meta = await listOpenPullsWithMeta(ctx);
    expect(meta.list_truncated).toBe(false);
    expect(meta.numbers).toHaveLength(5000);
  });

  it('listOpenPullsWithMeta sets list_truncated after max list pages when more exist', async () => {
    for (let page = 1; page <= 50; page += 1) {
      global.fetch.mockResolvedValueOnce(jsonPageResponse(openPullPage((page - 1) * 100 + 1)));
    }
    global.fetch.mockResolvedValueOnce(jsonPageResponse([{ number: 5001, state: 'open' }]));
    const meta = await listOpenPullsWithMeta(ctx);
    expect(meta.list_truncated).toBe(true);
    expect(meta.numbers).toHaveLength(5000);
  });

  it('listOpenPullsWithMeta sets list_truncated at maxPages when limit exceeds fetch window', async () => {
    for (let page = 1; page <= 50; page += 1) {
      global.fetch.mockResolvedValueOnce(jsonPageResponse(openPullPage((page - 1) * 100 + 1)));
    }
    global.fetch.mockResolvedValueOnce(jsonPageResponse([{ number: 5001, state: 'open' }]));
    const meta = await listOpenPullsWithMeta(ctx, { limit: 6000 });
    expect(meta.list_truncated).toBe(true);
    expect(meta.numbers).toHaveLength(5000);
  });

  it('crInventorySlice bounds entries when limit is 1 and list is complete', async () => {
    const pull = load('pull.json');
    const statuses = load('statuses-success.json');
    global.fetch.mockResolvedValueOnce(
      jsonPageResponse([{ number: 1, state: 'open' }], { 'X-Total-Count': '1' }),
    );
    global.fetch.mockResolvedValueOnce(jsonPageResponse(pull));
    global.fetch.mockResolvedValueOnce(jsonPageResponse(pull));
    global.fetch.mockResolvedValueOnce(jsonPageResponse(statuses));
    const body = await crInventorySlice(ctx, { limit: 1 });
    expect(body.list_truncated).toBe(false);
    expect(body.entries).toHaveLength(1);
    expect(body.entry_count).toBe(1);
  });

  it('crOpen POSTs pull create and maps response', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(JSON.stringify([]));
        },
      },
    });
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(
            JSON.stringify({
              number: 278,
              html_url: 'http://localhost:3000/attebury/remogram/pulls/278',
              title: 'impl: cr open',
            }),
          );
        },
      },
    });
    const body = await provider.crOpen(ctx, {
      head: 'impl/cr-open-lane-autonomy',
      base: 'remo',
      title: 'impl: cr open',
    });
    expect(body.pr_number).toBe(278);
    expect(global.fetch.mock.calls[1][1]?.method).toBe('POST');
    const postBody = JSON.parse(global.fetch.mock.calls[1][1]?.body);
    expect(postBody).toMatchObject({
      title: 'impl: cr open',
      head: 'impl/cr-open-lane-autonomy',
      base: 'remo',
    });
  });

  it('crOpen returns existing open PR without POST when head and base match', async () => {
    const existing = {
      number: 42,
      state: 'open',
      html_url: 'http://localhost:3000/attebury/remogram/pulls/42',
      title: 'Existing',
      head: { ref: 'feat/x' },
      base: { ref: 'remo' },
    };
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(JSON.stringify([existing]));
        },
      },
    });
    const body = await provider.crOpen(ctx, {
      head: 'feat/x',
      base: 'remo',
      title: 'New title',
    });
    expect(body.pr_number).toBe(42);
    expect(body.title).toBe('Existing');
    expect(body.reused_existing).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][1]?.method).toBeUndefined();
  });

  it('crOpen attaches idempotency fingerprint without echoing raw key', async () => {
    const existing = {
      number: 42,
      state: 'open',
      html_url: 'http://localhost:3000/attebury/remogram/pulls/42',
      title: 'Existing',
      head: { ref: 'feat/x' },
      base: { ref: 'remo' },
    };
    global.fetch.mockResolvedValueOnce(jsonPage([existing]));
    const fingerprint = 'abc123def4567890';
    const body = await provider.crOpen(ctx, {
      head: 'feat/x',
      base: 'remo',
      title: 'New title',
      idempotencyFingerprint: fingerprint,
    });
    expect(body.idempotency_fingerprint).toBe(fingerprint);
    expect(body.reused_existing).toBe(true);
    expect(JSON.stringify(body)).not.toContain('agent-retry');
  });

  function jsonPage(items) {
    return {
      ok: true,
      status: 200,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(JSON.stringify(items));
        },
      },
    };
  }

  function openPullMismatchPage(count) {
    return Array.from({ length: count }, (_, i) => ({
      number: i + 1,
      state: 'open',
      head: { ref: 'other' },
      base: { ref: 'remo' },
    }));
  }

  it('crOpen finds match on page 2 without POST', async () => {
    global.fetch.mockResolvedValueOnce(jsonPage(openPullMismatchPage(100)));
    global.fetch.mockResolvedValueOnce(
      jsonPage([
        {
          number: 99,
          state: 'open',
          html_url: 'http://localhost:3000/attebury/remogram/pulls/99',
          title: 'Page two',
          head: { ref: 'feat/x' },
          base: { ref: 'remo' },
        },
      ]),
    );
    const body = await provider.crOpen(ctx, {
      head: 'feat/x',
      base: 'remo',
      title: 'Ignored',
    });
    expect(body.pr_number).toBe(99);
    expect(body.reused_existing).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('crOpen idempotency scan uses ingest backoff at default ingest cap', async () => {
    delete process.env.REMOGRAM_FORGE_INGEST_MAX_BYTES;
    const paddedPulls = Array.from({ length: 25 }, (_, i) => ({
      number: i + 1,
      state: 'open',
      title: 'z'.repeat(400),
      head: { ref: 'other-head' },
      base: { ref: 'remo' },
    }));
    const oversizedJson = JSON.stringify(paddedPulls);
    expect(Buffer.byteLength(oversizedJson, 'utf8')).toBeGreaterThan(8192);

    global.fetch.mockImplementation((url, opts) => {
      const href = String(url);
      if (opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 201,
          body: {
            [Symbol.asyncIterator]: async function* () {
              yield Buffer.from(
                JSON.stringify({
                  number: 400,
                  html_url: 'http://localhost:3000/attebury/remogram/pulls/400',
                  title: 'T',
                }),
              );
            },
          },
        });
      }
      if (!href.includes('/pulls') || href.includes('/pulls/')) {
        return Promise.reject(new Error(`unexpected fetch: ${href}`));
      }
      const limitMatch = href.match(/[?&]limit=(\d+)/);
      const limit = limitMatch ? Number(limitMatch[1]) : 100;
      if (limit > 12) {
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
      return Promise.resolve(jsonPageResponse([]));
    });

    const body = await provider.crOpen(ctx, { head: 'feat/x', base: 'remo', title: 'T' });
    expect(body.pr_number).toBe(400);
    expect(global.fetch.mock.calls.some(([, o]) => o?.method === 'POST')).toBe(true);
  });

  it('crOpen fails closed when idempotency scan is truncated', async () => {
    for (let page = 0; page < MAX_OPEN_PULL_IDEMPOTENCY_PAGES; page += 1) {
      global.fetch.mockResolvedValueOnce(jsonPage(openPullMismatchPage(100)));
    }
    await expect(
      provider.crOpen(ctx, { head: 'feat/x', base: 'remo', title: 'T' }),
    ).rejects.toMatchObject({
      forgeError: expect.objectContaining({
        code: 'idempotency_scan_incomplete',
        fields: {
          idempotency_scan: {
            pages: MAX_OPEN_PULL_IDEMPOTENCY_PAGES,
            max_pages: MAX_OPEN_PULL_IDEMPOTENCY_PAGES,
            page_size: 100,
          },
        },
      }),
    });
    expect(global.fetch).toHaveBeenCalledTimes(MAX_OPEN_PULL_IDEMPOTENCY_PAGES);
  });

  it('crOpen rejects non-array open pull list', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('{}');
        },
      },
    });
    await expect(
      provider.crOpen(ctx, { head: 'feat/x', base: 'remo', title: 'T' }),
    ).rejects.toMatchObject({
      forgeError: expect.objectContaining({ code: 'unparseable_provider_output' }),
    });
  });

  it('crOpen maps API failure to forge error', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(JSON.stringify([]));
        },
      },
    });
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(JSON.stringify({ message: 'branch does not exist' }));
        },
      },
    });
    await expect(
      provider.crOpen(ctx, { head: 'missing', base: 'remo', title: 'T' }),
    ).rejects.toMatchObject({
      forgeError: expect.objectContaining({ code: 'api_error', status: 422 }),
    });
  });

  it('crOpen succeeds when POST response body exceeds default ingest cap (#574 P1)', async () => {
    delete process.env.REMOGRAM_FORGE_INGEST_MAX_BYTES;
    global.fetch.mockResolvedValueOnce(jsonPage([]));
    const largeBody = 'x'.repeat(20 * 1024);
    const pullJson = JSON.stringify({
      number: 574,
      html_url: 'http://localhost:3000/attebury/remogram/pulls/574',
      state: 'open',
      title: 'Large body PR',
      body: largeBody,
      body_html: `<p>${largeBody}</p>`,
      diff: 'd'.repeat(10 * 1024),
      patch: 'p'.repeat(10 * 1024),
    });
    expect(Buffer.byteLength(pullJson, 'utf8')).toBeGreaterThan(8192);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(pullJson);
        },
      },
    });
    const body = await provider.crOpen(ctx, {
      head: 'impl/cr-open-ingest-projection-574',
      base: 'remo',
      title: 'Large body PR',
      body: 'operator write body',
    });
    expect(body.pr_number).toBe(574);
    expect(body.created).toBe(true);
    expect(body.title).toBe('Large body PR');
    expect(body).not.toHaveProperty('body');
  });

  it('crOpen fails closed when projected POST response still exceeds ingest cap (#574 X2)', async () => {
    delete process.env.REMOGRAM_FORGE_INGEST_MAX_BYTES;
    global.fetch.mockResolvedValueOnce(jsonPage([]));
    const hugeTitle = 't'.repeat(9000);
    const pullJson = JSON.stringify({
      number: 575,
      html_url: 'http://localhost:3000/attebury/remogram/pulls/575',
      state: 'open',
      title: hugeTitle,
      body: 'x'.repeat(20 * 1024),
    });
    expect(Buffer.byteLength(pullJson, 'utf8')).toBeGreaterThan(8192);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(pullJson);
        },
      },
    });
    await expect(
      provider.crOpen(ctx, { head: 'feat/x', base: 'remo', title: 'Small title' }),
    ).rejects.toMatchObject({
      forgeError: expect.objectContaining({ code: 'oversized_raw_output' }),
    });
  });

  it('crOpen rejects HTTP redirect on POST create (#580 N1)', async () => {
    global.fetch.mockResolvedValueOnce(jsonPage([]));
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 302,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('');
        },
      },
    });
    await expect(
      provider.crOpen(ctx, { head: 'feat/x', base: 'remo', title: 'T' }),
    ).rejects.toMatchObject({
      forgeError: { code: 'api_error', message: 'HTTP redirect rejected' },
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('crOpen idempotency scan survives oversized pull bodies on list (#574 list projection P1)', async () => {
    delete process.env.REMOGRAM_FORGE_INGEST_MAX_BYTES;
    const largeBody = 'x'.repeat(5 * 1024);
    const pulls = [
      {
        number: 1,
        state: 'open',
        title: 'noise',
        body: largeBody,
        html_url: 'http://localhost:3000/attebury/remogram/pulls/1',
        head: { ref: 'other-head' },
        base: { ref: 'remo' },
      },
      {
        number: 99,
        state: 'open',
        title: 'Existing',
        body: largeBody,
        html_url: 'http://localhost:3000/attebury/remogram/pulls/99',
        head: { ref: 'feat/x' },
        base: { ref: 'remo' },
      },
    ];
    const oversizedJson = JSON.stringify(pulls);
    expect(Buffer.byteLength(oversizedJson, 'utf8')).toBeGreaterThan(8192);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(oversizedJson);
        },
      },
    });
    const body = await provider.crOpen(ctx, { head: 'feat/x', base: 'remo', title: 'Ignored' });
    expect(body.pr_number).toBe(99);
    expect(body.reused_existing).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(body).not.toHaveProperty('body');
  });

  it('crOpen completes idempotency scan then POST when oversized list has no head/base match (#574 list projection P2)', async () => {
    delete process.env.REMOGRAM_FORGE_INGEST_MAX_BYTES;
    const largeBody = 'x'.repeat(5 * 1024);
    const pulls = [
      {
        number: 1,
        state: 'open',
        title: 'other pr',
        body: largeBody,
        html_url: 'http://localhost:3000/attebury/remogram/pulls/1',
        head: { ref: 'other-head-1' },
        base: { ref: 'remo' },
      },
      {
        number: 2,
        state: 'open',
        title: 'another pr',
        body: largeBody,
        html_url: 'http://localhost:3000/attebury/remogram/pulls/2',
        head: { ref: 'other-head-2' },
        base: { ref: 'remo' },
      },
    ];
    const oversizedJson = JSON.stringify(pulls);
    expect(Buffer.byteLength(oversizedJson, 'utf8')).toBeGreaterThan(8192);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(oversizedJson);
        },
      },
    });
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(
            JSON.stringify({
              number: 576,
              html_url: 'http://localhost:3000/attebury/remogram/pulls/576',
              title: 'Brand new PR',
            }),
          );
        },
      },
    });
    const body = await provider.crOpen(ctx, {
      head: 'impl/brand-new',
      base: 'remo',
      title: 'Brand new PR',
    });
    expect(body.pr_number).toBe(576);
    expect(body.created).toBe(true);
    expect(global.fetch.mock.calls.some(([, o]) => o?.method === 'POST')).toBe(true);
  });

  it('issueOpen POSTs issue create and maps response', async () => {
    const issueCtx = {
      ...ctx,
      config: { ...ctx.config, write_commands: ['issue_open'] },
    };
    global.fetch.mockResolvedValueOnce(jsonPage([]));
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(
            JSON.stringify({
              number: 514,
              html_url: 'http://localhost:3000/attebury/remogram/issues/514',
              state: 'open',
              title: 'Wave 5 issue',
            }),
          );
        },
      },
    });
    const body = await provider.issueOpen(issueCtx, { title: 'Wave 5 issue' });
    expect(body.issue_number).toBe(514);
    expect(body.created).toBe(true);
    expect(body.body_bytes).toBe(0);
    expect(body.body_truncated).toBe(false);
    expect(global.fetch.mock.calls[1][1]?.method).toBe('POST');
  });

  it('issueOpen returns existing open issue without POST when title matches', async () => {
    const issueCtx = {
      ...ctx,
      config: { ...ctx.config, write_commands: ['issue_open'] },
    };
    const existing = {
      number: 99,
      state: 'open',
      html_url: 'http://localhost:3000/attebury/remogram/issues/99',
      title: 'Existing bug',
    };
    global.fetch.mockResolvedValueOnce(jsonPage([existing]));
    const body = await provider.issueOpen(issueCtx, { title: 'Existing bug' });
    expect(body.issue_number).toBe(99);
    expect(body.reused_existing).toBe(true);
    expect(body.created).toBeUndefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('issueOpen fails closed when idempotency scan is truncated', async () => {
    const issueCtx = {
      ...ctx,
      config: { ...ctx.config, write_commands: ['issue_open'] },
    };
    for (let page = 1; page <= MAX_OPEN_PULL_IDEMPOTENCY_PAGES; page += 1) {
      global.fetch.mockResolvedValueOnce(jsonPage(Array.from({ length: 100 }, (_, i) => ({
        number: page * 1000 + i,
        state: 'open',
        title: `other-${page}-${i}`,
      }))));
    }
    await expect(provider.issueOpen(issueCtx, { title: 'New unique title' })).rejects.toMatchObject({
      forgeError: expect.objectContaining({
        code: 'idempotency_scan_incomplete',
        fields: expect.objectContaining({
          idempotency_scan: expect.objectContaining({
            pages: MAX_OPEN_PULL_IDEMPOTENCY_PAGES,
          }),
        }),
      }),
    });
  });

  it('issueOpen succeeds when POST response body exceeds default ingest cap (#572 P1)', async () => {
    delete process.env.REMOGRAM_FORGE_INGEST_MAX_BYTES;
    const issueCtx = {
      ...ctx,
      config: { ...ctx.config, write_commands: ['issue_open'] },
    };
    global.fetch.mockResolvedValueOnce(jsonPage([]));
    const largeBody = 'x'.repeat(20 * 1024);
    const issueJson = JSON.stringify({
      number: 572,
      html_url: 'http://localhost:3000/attebury/remogram/issues/572',
      state: 'open',
      title: 'Large body issue',
      body: largeBody,
      body_html: `<p>${largeBody}</p>`,
    });
    expect(Buffer.byteLength(issueJson, 'utf8')).toBeGreaterThan(8192);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(issueJson);
        },
      },
    });
    const body = await provider.issueOpen(issueCtx, {
      title: 'Large body issue',
      body: 'operator write body',
    });
    expect(body.issue_number).toBe(572);
    expect(body.created).toBe(true);
    expect(body.title).toBe('Large body issue');
    expect(body).not.toHaveProperty('body');
  });

  it('issueOpen fails closed when projected POST response still exceeds ingest cap (#572 X2)', async () => {
    delete process.env.REMOGRAM_FORGE_INGEST_MAX_BYTES;
    const issueCtx = {
      ...ctx,
      config: { ...ctx.config, write_commands: ['issue_open'] },
    };
    global.fetch.mockResolvedValueOnce(jsonPage([]));
    const hugeTitle = 't'.repeat(9000);
    const issueJson = JSON.stringify({
      number: 573,
      html_url: 'http://localhost:3000/attebury/remogram/issues/573',
      state: 'open',
      title: hugeTitle,
      body: 'x'.repeat(20 * 1024),
    });
    expect(Buffer.byteLength(issueJson, 'utf8')).toBeGreaterThan(8192);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(issueJson);
        },
      },
    });
    await expect(
      provider.issueOpen(issueCtx, { title: 'Small title' }),
    ).rejects.toMatchObject({
      forgeError: expect.objectContaining({ code: 'oversized_raw_output' }),
    });
  });

  it('issueOpen idempotency scan survives oversized issue bodies on list (#572 list projection P1)', async () => {
    delete process.env.REMOGRAM_FORGE_INGEST_MAX_BYTES;
    const issueCtx = {
      ...ctx,
      config: { ...ctx.config, write_commands: ['issue_open'] },
    };
    const largeBody = 'x'.repeat(5 * 1024);
    const issues = [
      {
        number: 1,
        state: 'open',
        title: 'noise',
        body: largeBody,
        html_url: 'http://localhost:3000/attebury/remogram/issues/1',
      },
      {
        number: 99,
        state: 'open',
        title: 'Existing bug',
        body: largeBody,
        html_url: 'http://localhost:3000/attebury/remogram/issues/99',
      },
    ];
    const oversizedJson = JSON.stringify(issues);
    expect(Buffer.byteLength(oversizedJson, 'utf8')).toBeGreaterThan(8192);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(oversizedJson);
        },
      },
    });
    const body = await provider.issueOpen(issueCtx, { title: 'Existing bug' });
    expect(body.issue_number).toBe(99);
    expect(body.reused_existing).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(body).not.toHaveProperty('body');
  });

  it('issueOpen completes idempotency scan then POST when oversized list has no title match (#572 list projection P2)', async () => {
    delete process.env.REMOGRAM_FORGE_INGEST_MAX_BYTES;
    const issueCtx = {
      ...ctx,
      config: { ...ctx.config, write_commands: ['issue_open'] },
    };
    const largeBody = 'x'.repeat(5 * 1024);
    const issues = [
      {
        number: 1,
        state: 'open',
        title: 'other issue',
        body: largeBody,
        html_url: 'http://localhost:3000/attebury/remogram/issues/1',
      },
      {
        number: 2,
        state: 'open',
        title: 'another issue',
        body: largeBody,
        html_url: 'http://localhost:3000/attebury/remogram/issues/2',
      },
    ];
    const oversizedJson = JSON.stringify(issues);
    expect(Buffer.byteLength(oversizedJson, 'utf8')).toBeGreaterThan(8192);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(oversizedJson);
        },
      },
    });
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(
            JSON.stringify({
              number: 600,
              html_url: 'http://localhost:3000/attebury/remogram/issues/600',
              state: 'open',
              title: 'Brand new issue',
            }),
          );
        },
      },
    });
    const body = await provider.issueOpen(issueCtx, { title: 'Brand new issue' });
    expect(body.issue_number).toBe(600);
    expect(body.created).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][1]?.method).toBe('POST');
    expect(body).not.toHaveProperty('body');
  });

  it('issueView links a change request when issue pull metadata resolves', async () => {
    const issue = {
      number: 42,
      html_url: 'http://localhost:3000/attebury/remogram/issues/42',
      state: 'open',
      title: 'Track CR progress',
      pull_request: { url: 'http://localhost:3000/api/v1/repos/attebury/remogram/pulls/42' },
    };
    const pull = {
      number: 42,
      html_url: 'http://localhost:3000/attebury/remogram/pulls/42',
      state: 'open',
      title: 'Fix thing',
      base: { ref: 'remo', sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      head: { ref: 'feat/x', sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    };
    global.fetch.mockResolvedValueOnce(jsonPageResponse(issue));
    global.fetch.mockResolvedValueOnce(jsonPageResponse(pull));
    const body = await provider.issueView(ctx, { number: 42 });
    expect(body.issue_number).toBe(42);
    expect(body.linked_change_request).toEqual({
      pr_number: 42,
      url: 'http://localhost:3000/attebury/remogram/pulls/42',
      state: 'open',
      title: 'Fix thing',
    });
  });

  it('issueComments maps paginated comments', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonPageResponse([
        { id: 1, body: 'first', user: { login: 'triage' } },
        { id: 2, body: 'second', user: { login: 'maintainer' } },
      ]),
    );
    const body = await provider.issueComments(ctx, { number: 42 });
    expect(body.issue_number).toBe(42);
    expect(body.comments).toHaveLength(2);
    expect(body.comment_count).toBe(2);
  });

  it('issueInventorySlice emits issue entries and pagination fields', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonPageResponse([{ number: 10, state: 'open', title: 'Issue 10' }]),
    );
    global.fetch.mockResolvedValueOnce(
      jsonPageResponse({
        number: 10,
        html_url: 'http://localhost:3000/attebury/remogram/issues/10',
        state: 'open',
        title: 'Issue 10',
      }),
    );
    const body = await provider.issueInventory(ctx, { limit: 1 });
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].issue_number).toBe(10);
    expect(body.entry_count).toBe(1);
    expect(body.slice_sort).toBe('number_asc');
  });

  it('listOpenPullsWithMeta fast path uses X-Total-Count with retain_max', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonPageResponse(
        [
          { number: 30, state: 'open' },
          { number: 10, state: 'open' },
          { number: 20, state: 'open' },
        ],
        { 'X-Total-Count': '3' },
      ),
    );
    const meta = await listOpenPullsWithMeta(ctx, { retain_max: 3, sort: 'recent_update' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String(global.fetch.mock.calls[0][0])).toContain('sort=recentupdate');
    expect(meta.entry_count).toBe(3);
    expect(meta.list_truncated).toBe(false);
    expect(meta.numbers).toEqual([30, 10, 20]);
    expect(meta.slice_sort).toBe('recent_update');
  });

  it('listOpenPullsWithMeta fast path fails closed when total exceeds compliant max', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonPageResponse([{ number: 1, state: 'open' }], { 'X-Total-Count': '5001' }),
    );
    const meta = await listOpenPullsWithMeta(ctx, { retain_max: 3 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(meta.list_truncated).toBe(true);
    expect(meta.entry_count).toBe(5001);
  });

  it('listOpenPullsWithMeta falls back when X-Total-Count header is invalid', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonPageResponse([{ number: 1, state: 'open' }], { 'X-Total-Count': 'not-a-number' }),
    );
    global.fetch.mockResolvedValueOnce(jsonPageResponse([]));
    const meta = await listOpenPullsWithMeta(ctx, { retain_max: 3 });
    expect(global.fetch.mock.calls.length).toBe(2);
    expect(meta.list_truncated).toBe(false);
  });

  it('listOpenPullsWithMeta default sort keeps lowest numbers', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonPageResponse(
        [
          { number: 30, state: 'open' },
          { number: 10, state: 'open' },
          { number: 20, state: 'open' },
        ],
        { 'X-Total-Count': '3' },
      ),
    );
    const meta = await listOpenPullsWithMeta(ctx, { retain_max: 3 });
    expect(meta.numbers).toEqual([10, 20, 30]);
    expect(meta.slice_sort).toBe('number_asc');
  });

  it('listOpenPullsWithMeta recent_created uses sort=oldest and reverses page order', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonPageResponse(
        [
          { number: 10, state: 'open' },
          { number: 20, state: 'open' },
          { number: 30, state: 'open' },
        ],
        { 'X-Total-Count': '3' },
      ),
    );
    const meta = await listOpenPullsWithMeta(ctx, { retain_max: 3, sort: 'recent_created' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String(global.fetch.mock.calls[0][0])).toContain('sort=oldest');
    expect(meta.numbers).toEqual([30, 20, 10]);
    expect(meta.slice_sort).toBe('recent_created');
  });

  it('listOpenPullsWithMeta recent_created order differs from recent_update', async () => {
    const oldestFirst = [
      { number: 10, state: 'open' },
      { number: 20, state: 'open' },
      { number: 30, state: 'open' },
    ];
    global.fetch.mockResolvedValueOnce(
      jsonPageResponse(oldestFirst, { 'X-Total-Count': '3' }),
    );
    const created = await listOpenPullsWithMeta(ctx, { retain_max: 3, sort: 'recent_created' });
    global.fetch.mockResolvedValueOnce(
      jsonPageResponse(oldestFirst, { 'X-Total-Count': '3' }),
    );
    const updated = await listOpenPullsWithMeta(ctx, { retain_max: 3, sort: 'recent_update' });
    expect(created.numbers).toEqual([30, 20, 10]);
    expect(updated.numbers).toEqual([10, 20, 30]);
  });

  it('listOpenPullsWithMeta falls back when body shorter than min(total, limit)', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonPageResponse([{ number: 1, state: 'open' }], { 'X-Total-Count': '5' }),
    );
    global.fetch.mockResolvedValueOnce(jsonPageResponse([]));
    const meta = await listOpenPullsWithMeta(ctx, { retain_max: 3 });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(String(global.fetch.mock.calls[1][0])).toContain('page=2');
    expect(meta.numbers).toEqual([1]);
    expect(meta.entry_count).toBe(5);
    expect(meta.list_truncated).toBe(true);
  });

  it('listOpenPullsWithMeta recent_created fetches tail page when total exceeds retain_max', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonPageResponse(
        [{ number: 1, state: 'open' }, { number: 2, state: 'open' }, { number: 3, state: 'open' }],
        { 'X-Total-Count': '250' },
      ),
    );
    global.fetch.mockResolvedValueOnce(
      jsonPageResponse([
        { number: 248, state: 'open' },
        { number: 249, state: 'open' },
        { number: 250, state: 'open' },
      ]),
    );
    const meta = await listOpenPullsWithMeta(ctx, { retain_max: 3, sort: 'recent_created' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(String(global.fetch.mock.calls[1][0])).toContain('page=3');
    expect(String(global.fetch.mock.calls[1][0])).toContain('sort=oldest');
    expect(meta.numbers).toEqual([250, 249, 248]);
    expect(meta.entry_count).toBe(250);
  });

  it('listOpenPullsWithMeta number_asc full-collects when total exceeds retain_max', async () => {
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
    global.fetch.mockResolvedValueOnce(
      jsonPageResponse(allMrs.slice(0, 3), { 'X-Total-Count': '10' }),
    );
    global.fetch.mockResolvedValueOnce(jsonPageResponse(allMrs.slice(3)));
    const meta = await listOpenPullsWithMeta(ctx, { retain_max: 3, sort: 'number_asc' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(meta.entry_count).toBe(10);
    expect(meta.numbers).toEqual([1, 2, 3]);
  });

  it('listOpenPullsWithMeta skips fast path for number_asc when total exceeds retain_max', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonPageResponse(
        [
          { number: 30, state: 'open' },
          { number: 10, state: 'open' },
          { number: 20, state: 'open' },
        ],
        { 'X-Total-Count': '10' },
      ),
    );
    global.fetch.mockResolvedValueOnce(jsonPageResponse([]));
    const meta = await listOpenPullsWithMeta(ctx, { retain_max: 3, sort: 'number_asc' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(meta.slice_sort).toBe('number_asc');
  });

  it('listOpenPullsWithMeta recent_created tail page when total not multiple of page size', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonPageResponse(
        [{ number: 1, state: 'open' }, { number: 2, state: 'open' }, { number: 3, state: 'open' }],
        { 'X-Total-Count': '105' },
      ),
    );
    global.fetch.mockResolvedValueOnce(
      jsonPageResponse([
        { number: 101, state: 'open' },
        { number: 102, state: 'open' },
        { number: 103, state: 'open' },
        { number: 104, state: 'open' },
        { number: 105, state: 'open' },
      ]),
    );
    const meta = await listOpenPullsWithMeta(ctx, { retain_max: 3, sort: 'recent_created' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(String(global.fetch.mock.calls[1][0])).toContain('page=2');
    expect(meta.numbers).toEqual([105, 104, 103]);
    expect(meta.entry_count).toBe(105);
  });

  it('listOpenPullsWithMeta recent_created tail failure uses tail page not page 1', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonPageResponse(
        [{ number: 1, state: 'open' }, { number: 2, state: 'open' }, { number: 3, state: 'open' }],
        { 'X-Total-Count': '250' },
      ),
    );
    global.fetch.mockRejectedValueOnce(new Error('tail fetch failed'));
    global.fetch.mockRejectedValueOnce(new Error('tail retry failed'));
    global.fetch.mockResolvedValueOnce(
      jsonPageResponse([
        { number: 248, state: 'open' },
        { number: 249, state: 'open' },
        { number: 250, state: 'open' },
      ]),
    );
    const meta = await listOpenPullsWithMeta(ctx, { retain_max: 3, sort: 'recent_created' });
    expect(global.fetch).toHaveBeenCalledTimes(4);
    const pageOneCalls = global.fetch.mock.calls.filter(([url]) => /[?&]page=1(?:&|$)/.test(String(url)));
    expect(pageOneCalls).toHaveLength(1);
    expect(String(global.fetch.mock.calls[3][0])).toContain('page=3');
    expect(meta.numbers).toEqual([250, 249, 248]);
    expect(meta.entry_count).toBe(250);
  });

  it('providerCapabilities reports write_support for cr_open and merge', async () => {
    const body = await provider.providerCapabilities();
    expect(body.write_support).toBe(true);
    expect(body.write_commands).toEqual(['cr_open', 'status_set', 'merge', 'issue_open']);
    expect(body.idempotency_scan).toEqual({
      max_pages: MAX_OPEN_PULL_IDEMPOTENCY_PAGES,
      page_size: 100,
      ingest_backoff: 'halve_until_fit',
    });
    expect(body.open_pull_list).toEqual({
      max_pages: 50,
      page_size: 100,
      ingest_backoff: 'halve_until_fit',
      compliant_max_items: 5000,
      truncation_packet_field: 'list_truncated',
      incomplete_error_code: 'inventory_list_incomplete',
      default_slice_sort: 'number_asc',
      supported_slice_sorts: ['number_asc', 'number_desc', 'recent_update', 'recent_created'],
      total_count_source: 'response_header',
      total_count_header: 'X-Total-Count',
      slice_sort_notes: {
        recent_created:
          'sort=oldest; fetches tail page when total exceeds limit; page reversed for newest-first',
        number_asc:
          'full-list collect within compliant_max when total exceeds limit, then client sort',
        number_desc:
          'full-list collect within compliant_max when total exceeds limit, then client sort',
      },
    });
    const crOpen = body.commands.find((c) => c.name === 'cr_open');
    expect(crOpen).toMatchObject({ implemented: true, auth_class: 'token_required' });
    const mergeExecute = body.commands.find((c) => c.name === 'merge_execute');
    expect(mergeExecute).toMatchObject({ implemented: true, auth_class: 'token_required' });
  });

  it('branchHeadSha returns commit id from Gitea branch endpoint', async () => {
    const branchSha = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(JSON.stringify({ name: 'feat', commit: { id: branchSha } }));
        },
      },
    });
    const sha = await provider.branchHeadSha(ctx, 'feat');
    expect(sha).toBe(branchSha);
    expect(String(global.fetch.mock.calls[0][0])).toContain('/repos/attebury/remogram/branches/feat');
  });

  it('branchHeadSha rejects branch response without commit id', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(JSON.stringify({ name: 'feat' }));
        },
      },
    });
    await expect(provider.branchHeadSha(ctx, 'feat')).rejects.toMatchObject({
      forgeError: { code: 'unparseable_provider_output' },
    });
  });

  it('branchHeadSha rejects malformed commit id', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(JSON.stringify({ name: 'feat', commit: { id: 'not-a-sha' } }));
        },
      },
    });
    await expect(provider.branchHeadSha(ctx, 'feat')).rejects.toMatchObject({
      forgeError: { code: 'unparseable_provider_output' },
    });
  });

  it('branchHeadSha reads branch from fork repo when repoId override is set', async () => {
    const branchSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(JSON.stringify({ name: 'feature/x', commit: { id: branchSha } }));
        },
      },
    });
    const sha = await provider.branchHeadSha(ctx, 'feature/x', { repoId: 'forker/fork' });
    expect(sha).toBe(branchSha);
    expect(String(global.fetch.mock.calls[0][0])).toContain('/repos/forker/fork/branches/feature%2Fx');
  });

  it('repoApiPathFor encodes owner and repo segments', () => {
    expect(repoApiPathFor('fork er', 'fork', 'branches', 'feat/x')).toContain(
      encodeURIComponent('fork er'),
    );
  });

  it('branchHeadSha rejects invalid branch ref', async () => {
    await expect(provider.branchHeadSha(ctx, '../evil')).rejects.toMatchObject({
      forgeError: { code: 'invalid_args' },
    });
  });

  it('branchHeadSha rejects when Gitea branch endpoint returns 404', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(JSON.stringify({ message: 'Branch not found' }));
        },
      },
    });
    await expect(provider.branchHeadSha(ctx, 'missing-branch')).rejects.toMatchObject({
      forgeError: { code: 'api_error' },
      status: 404,
    });
  });

  it('mergeExecute accepts writePolicy operator overlay without repo write_commands', async () => {
    const policyCtx = {
      ...ctx,
      config: { ...ctx.config, write_commands: [] },
      writePolicy: {
        repoWriteCommands: [],
        operatorWriteCommands: ['merge'],
        effectiveWriteCommands: ['merge'],
        operatorMeta: { discovered_via: 'env' },
        operatorError: null,
      },
    };
    await expect(
      provider.mergeExecute(policyCtx, { number: 42, method: 'merge' }),
    ).rejects.toMatchObject({
      invalidArgs: expect.stringMatching(/expectedHeadSha/),
    });
  });

  it('mergeExecute rejects when effective write policy omits merge', async () => {
    const policyCtx = {
      ...ctx,
      config: { ...ctx.config, write_commands: [] },
      writePolicy: {
        repoWriteCommands: [],
        operatorWriteCommands: [],
        effectiveWriteCommands: [],
        operatorError: null,
      },
    };
    await expect(
      provider.mergeExecute(policyCtx, {
        number: 42,
        method: 'merge',
        expectedHeadSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    ).rejects.toMatchObject({
      forgeError: expect.objectContaining({ code: 'write_not_configured' }),
    });
  });

  it('mergeExecute POSTs Gitea merge endpoint with head_commit_id pin', async () => {
    process.env.GITEA_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn());
    const mergeSha = 'dddddddddddddddddddddddddddddddddddddddd';
    const expectedHeadSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    try {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from(JSON.stringify({ sha: mergeSha }));
          },
        },
      });
      const result = await provider.mergeExecute(ctx, {
        number: 42,
        method: 'merge',
        expectedHeadSha,
      });
      expect(result.commit_sha).toBe(mergeSha);
      expect(String(global.fetch.mock.calls[0][0])).toContain('/pulls/42/merge');
      const init = global.fetch.mock.calls[0][1];
      expect(JSON.parse(init.body)).toEqual({
        Do: 'merge',
        head_commit_id: expectedHeadSha,
      });
    } finally {
      vi.unstubAllGlobals();
      delete process.env.GITEA_TOKEN;
    }
  });

  it('mergeExecute readbacks target branch tip when merge POST omits SHAs (#587)', async () => {
    process.env.GITEA_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn());
    const expectedHeadSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const postMergeBase = 'cccccccccccccccccccccccccccccccccccccccc';
    try {
      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          body: {
            [Symbol.asyncIterator]: async function* () {
              yield Buffer.from(JSON.stringify({}));
            },
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          body: {
            [Symbol.asyncIterator]: async function* () {
              yield Buffer.from(JSON.stringify({ merged: true, base: { ref: 'remo' } }));
            },
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          body: {
            [Symbol.asyncIterator]: async function* () {
              yield Buffer.from(JSON.stringify({ commit: { id: postMergeBase } }));
            },
          },
        });
      const result = await provider.mergeExecute(ctx, {
        number: 42,
        method: 'merge',
        expectedHeadSha,
        targetBranchRef: 'remo',
      });
      expect(result.base_sha).toBe(postMergeBase);
      expect(result.post_merge_readback).toEqual({ status: 'proved' });
      expect(global.fetch).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.GITEA_TOKEN;
    }
  });

  it('mergeExecute remaps Gitea 409 head out of date to merge_blocked head_ref_moved', async () => {
    process.env.GITEA_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn());
    const expectedHeadSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    try {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from(JSON.stringify({ message: 'head out of date' }));
          },
        },
      });
      await expect(
        provider.mergeExecute(ctx, { number: 42, method: 'merge', expectedHeadSha }),
      ).rejects.toMatchObject({
        mergeBlockedBlockers: ['head_ref_moved'],
        forgeError: { code: 'merge_blocked', status: 409 },
      });
    } finally {
      vi.unstubAllGlobals();
      delete process.env.GITEA_TOKEN;
    }
  });

  it('mergeExecute remaps Gitea 409 sha mismatch to merge_blocked head_ref_moved', async () => {
    process.env.GITEA_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn());
    const expectedHeadSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    try {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from(JSON.stringify({ message: 'sha mismatch on merge' }));
          },
        },
      });
      await expect(
        provider.mergeExecute(ctx, { number: 42, method: 'merge', expectedHeadSha }),
      ).rejects.toMatchObject({
        mergeBlockedBlockers: ['head_ref_moved'],
        forgeError: { code: 'merge_blocked', status: 409 },
      });
    } finally {
      vi.unstubAllGlobals();
      delete process.env.GITEA_TOKEN;
    }
  });

  it('isGiteaHeadOutOfDate409 matches head out of date and sha mismatch messages', () => {
    expect(isGiteaHeadOutOfDate409({ status: 409, message: 'head out of date' })).toBe(true);
    expect(isGiteaHeadOutOfDate409({ status: 409, message: 'SHA mismatch' })).toBe(true);
    expect(isGiteaHeadOutOfDate409({ status: 409, message: 'merge conflict' })).toBe(false);
    expect(isGiteaHeadOutOfDate409({ status: 404, message: 'head out of date' })).toBe(false);
  });

  it('mergeExecute leaves other 409 responses as api_error', async () => {
    process.env.GITEA_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn());
    const expectedHeadSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    try {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from(JSON.stringify({ message: 'merge conflict' }));
          },
        },
      });
      await expect(
        provider.mergeExecute(ctx, { number: 42, method: 'merge', expectedHeadSha }),
      ).rejects.toMatchObject({
        forgeError: { code: 'api_error', status: 409 },
      });
    } finally {
      vi.unstubAllGlobals();
      delete process.env.GITEA_TOKEN;
    }
  });

  it('mergeExecute rejects missing expectedHeadSha', async () => {
    process.env.GITEA_TOKEN = 'test-token';
    await expect(provider.mergeExecute(ctx, { number: 1, method: 'merge' })).rejects.toMatchObject({
      invalidArgs: 'expectedHeadSha must be a 40-character git SHA',
    });
    delete process.env.GITEA_TOKEN;
  });

  it('mergeExecute rejects unsupported method', async () => {
    process.env.GITEA_TOKEN = 'test-token';
    await expect(provider.mergeExecute(ctx, { number: 1, method: 'squash' })).rejects.toMatchObject({
      forgeError: { code: 'invalid_args' },
    });
    delete process.env.GITEA_TOKEN;
  });
});
