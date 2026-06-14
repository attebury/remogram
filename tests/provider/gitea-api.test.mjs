import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provider, repoApiPath, apiBase, normalizeGiteaStatusState, normalizeGiteaPrState, listOpenPullsWithMeta, crInventorySlice } from '@remogram/provider-gitea-api';
import { DEFAULT_CHECK_STATUS_PAGE_SIZE } from '@remogram/core';

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

  it('providerCapabilities reports supported pagination', () => {
    const caps = provider.providerCapabilities();
    expect(caps.pagination).toBe('supported');
    expect(caps.forge_ingest_cap_bytes).toBe(8192);
    expect(caps.check_pagination).toEqual({
      strategy: 'offset_limit',
      page_size: 25,
      max_pages: 50,
      page_size_param: 'limit',
      ingest_backoff: 'halve_until_fit',
      on_page_cap: 'set_checks_truncated',
      compliant_max_items_per_source: 1250,
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

  it('listOpenPullsWithMeta honors list limit in HTTP query', async () => {
    global.fetch.mockResolvedValueOnce(jsonPageResponse([{ number: 1, state: 'open' }]));
    const meta = await listOpenPullsWithMeta(ctx, { limit: 1 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('limit=1');
    expect(meta.numbers).toEqual([1]);
    expect(meta.list_truncated).toBe(true);
  });

  it('listOpenPullsWithMeta sets list_truncated after max list pages', async () => {
    for (let page = 1; page <= 50; page += 1) {
      global.fetch.mockResolvedValueOnce(jsonPageResponse(openPullPage((page - 1) * 100 + 1)));
    }
    const meta = await listOpenPullsWithMeta(ctx);
    expect(meta.list_truncated).toBe(true);
    expect(meta.numbers).toHaveLength(5000);
  });

  it('crInventorySlice bounds open PR list before ingest when limit is 1', async () => {
    const pull = load('pull.json');
    global.fetch.mockResolvedValueOnce(jsonPageResponse([{ number: 1, state: 'open' }]));
    global.fetch
      .mockResolvedValueOnce(jsonPageResponse(pull))
      .mockResolvedValueOnce(jsonPageResponse(pull))
      .mockResolvedValueOnce(jsonPageResponse([]));
    const body = await crInventorySlice(ctx, { limit: 1 });
    expect(global.fetch.mock.calls[0][0]).toContain('limit=1');
    expect(body.list_truncated).toBe(true);
    expect(body.entries).toHaveLength(1);
  });
});
