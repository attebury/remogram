import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provider, repoApiPath, apiBase, normalizeGiteaStatusState, normalizeGiteaPrState } from '@remogram/provider-gitea-api';

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

  it('providerCapabilities reports supported pagination', () => {
    const caps = provider.providerCapabilities();
    expect(caps.pagination).toBe('supported');
    expect(caps.forge_ingest_cap_bytes).toBe(8192);
  });
});
