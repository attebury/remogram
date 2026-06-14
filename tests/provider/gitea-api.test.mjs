import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provider, repoApiPath, apiBase, normalizeGiteaStatusState, normalizeGiteaPrState, listOpenPullsWithMeta, crInventorySlice, dedupeGiteaStatusRecords, mapGiteaCommitStatuses } from '@remogram/provider-gitea-api';
import { DEFAULT_CHECK_STATUS_PAGE_SIZE, MAX_CHECK_STATUS_PAGES, MAX_OPEN_PULL_IDEMPOTENCY_PAGES } from '@remogram/core';

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
  });

  afterEach(() => {
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

  function jsonPageResponse(body) {
    return {
      ok: true,
      status: 200,
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
    global.fetch.mockResolvedValueOnce(jsonPageResponse([{ number: 1, state: 'open' }]));
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

  it('providerCapabilities reports write_support for cr_open', async () => {
    const body = await provider.providerCapabilities();
    expect(body.write_support).toBe(true);
    expect(body.write_commands).toEqual(['cr_open']);
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
    });
    const crOpen = body.commands.find((c) => c.name === 'cr_open');
    expect(crOpen).toMatchObject({ implemented: true, auth_class: 'token_required' });
  });
});
