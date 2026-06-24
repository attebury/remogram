import { describe, it, expect, afterEach, vi } from 'vitest';
import { runCli } from '@remogram/cli';
import { PACKET_TYPES, SCHEMA_VERSION, ERROR_CODES, forgeError, buildMergePlanBodyFromFacts, resetIdempotencyScopeBindings } from '@remogram/core';
import { provider as giteaProvider } from '@remogram/provider-gitea-api';
import * as giteaBranchProtection from '@remogram/provider-gitea-api/branch-protection-internal.js';
import { setupTempForge, captureCliOutput } from '../helpers/temp-forge.mjs';
import { createMockProvider, defaultTestConfig } from '../helpers/mock-provider.mjs';

describe('remogram cli commands', () => {
  /** @type {ReturnType<typeof setupTempForge>[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop().cleanup();
    resetIdempotencyScopeBindings();
    delete process.env.GITEA_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.REMOGRAM_FORGE_INGEST_MAX_BYTES;
    delete process.env.REMOGRAM_OPERATOR_CONFIG;
    delete process.env.REMOGRAM_WRITE_FIELD_MAX_BYTES;
  });

  function env() {
    const config = defaultTestConfig();
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const provider = createMockProvider();
    const providers = { 'gitea-api': provider };
    async function cli(args) {
      return captureCliOutput(() =>
        runCli([...args, '--json'], { cwd: setup.dir, providers }),
      );
    }
    return { cli, setup };
  }

  function expectEnvelope(packet) {
    expect(packet.schema_version).toBe(SCHEMA_VERSION);
    expect(packet.provider_id).toBe('gitea-api');
    expect(packet.remote_name).toBe('origin');
    expect(packet.repo_id).toBe('owner/repo');
    expect(packet.observed_at).toMatch(/^\d{4}-/);
    expect(typeof packet.ok).toBe('boolean');
  }

  it('repo status', async () => {
    const { cli } = env();
    const { logs } = await cli(['repo', 'status']);
    const packet = JSON.parse(logs[0]);
    expectEnvelope(packet);
    expect(packet.type).toBe(PACKET_TYPES.REPO_STATUS);
    expect(packet.ok).toBe(true);
    expect(packet.auth_present).toBe(true);
  });

  it('provider capabilities', async () => {
    const { cli } = env();
    const { logs } = await cli(['provider', 'capabilities']);
    const packet = JSON.parse(logs[0]);
    expectEnvelope(packet);
    expect(packet.type).toBe(PACKET_TYPES.PROVIDER_CAPABILITIES);
    expect(packet.commands).toContainEqual({ name: 'repo_status', implemented: true });
    expect(packet.auth_envs).toEqual(['GITEA_TOKEN']);
    expect(packet.check_sources).toEqual(['commit_statuses']);
    expect(packet.mergeability_confidence).toBe('direct');
    expect(packet.host_binding).toBe('trusted_base_url');
    expect(packet.pagination).toBe('first_page_only');
    expect(packet.write_support).toBe(true);
    expect(packet.write_commands).toEqual(['cr_open', 'status_set', 'merge', 'issue_open']);
    expect(packet.forge_ingest_cap_bytes).toBe(8192);
  });

  it('provider capabilities reports fact inventory commands honestly', async () => {
    const config = defaultTestConfig();
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const { logs } = await captureCliOutput(() =>
      runCli(['provider', 'capabilities', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': giteaProvider },
      }),
    );
    const packet = JSON.parse(logs[0]);
    const byName = Object.fromEntries(packet.commands.map((command) => [command.name, command]));
    expect(byName.ref_inventory).toMatchObject({
      implemented: true,
      auth_class: 'git_only',
    });
    expect(byName.cr_inventory).toMatchObject({
      implemented: true,
      auth_class: 'token_required',
    });
  });

  it('doctor reports readiness without secrets', async () => {
    delete process.env.GITEA_TOKEN;
    const { cli } = env();
    const { logs } = await cli(['doctor']);
    const packet = JSON.parse(logs[0]);
    expectEnvelope(packet);
    expect(packet.type).toBe(PACKET_TYPES.PROVIDER_DOCTOR);
    expect(packet.ok).toBe(true);
    expect(packet.summary).toBe('warn');
    expect(packet.provider_capabilities.auth_envs).toEqual(['GITEA_TOKEN']);
    expect(packet.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'config', status: 'pass' }),
        expect.objectContaining({ name: 'remote', status: 'pass' }),
        expect.objectContaining({ name: 'host_binding', status: 'pass' }),
        expect.objectContaining({ name: 'auth', status: 'warn' }),
      ]),
    );
    expect(JSON.stringify(packet)).not.toContain('test-token');
  });

  it('doctor warns when forge ingest cap env override is set', async () => {
    process.env.REMOGRAM_FORGE_INGEST_MAX_BYTES = '16384';
    const { cli } = env();
    const { logs } = await cli(['doctor']);
    const packet = JSON.parse(logs[0]);
    expect(packet.summary).toBe('warn');
    expect(packet.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'forge_ingest_cap',
          status: 'warn',
          details: expect.objectContaining({ effective_bytes: 16384, env_override: true }),
        }),
      ]),
    );
  });

  it('doctor warns when forge ingest cap env override is clamped', async () => {
    process.env.REMOGRAM_FORGE_INGEST_MAX_BYTES = '999999';
    const { cli } = env();
    const { logs } = await cli(['doctor']);
    const packet = JSON.parse(logs[0]);
    expect(packet.summary).toBe('warn');
    expect(packet.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'forge_ingest_cap',
          status: 'warn',
          message: expect.stringMatching(/clamped/i),
          details: expect.objectContaining({ effective_bytes: 65536, env_override: true, clamped: true }),
        }),
      ]),
    );
  });

  it('doctor warns on stub provider', async () => {
    const config = {
      version: '1',
      provider: 'github-gh',
      owner: 'owner',
      repo: 'repo',
      remote: 'origin',
    };
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://github.com/owner/repo.git',
    });
    cleanups.push(setup);
    const { provider: githubGh } = await import('@remogram/provider-github-gh');
    const providers = { 'github-gh': githubGh };
    const { logs } = await captureCliOutput(() =>
      runCli(['doctor', '--json'], { cwd: setup.dir, providers }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.summary).toBe('warn');
    expect(packet.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'provider',
          status: 'warn',
          message: expect.stringMatching(/not fully supported/i),
        }),
      ]),
    );
  });

  it('doctor warns on gitea-tea stub provider', async () => {
    const config = {
      version: '1',
      provider: 'gitea-tea',
      owner: 'owner',
      repo: 'repo',
      remote: 'origin',
    };
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const { provider: giteaTea } = await import('@remogram/provider-gitea-tea');
    const providers = { 'gitea-tea': giteaTea };
    const { logs } = await captureCliOutput(() =>
      runCli(['doctor', '--json'], { cwd: setup.dir, providers }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.summary).toBe('warn');
    expect(packet.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'provider',
          status: 'warn',
          message: expect.stringMatching(/not fully supported/i),
        }),
      ]),
    );
  });

  it('doctor warns when provider supports writes but write_commands omitted', async () => {
    const config = defaultTestConfig();
    delete config.write_commands;
    const setup = setupTempForge({
      config,
      remoteUrl: 'http://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    process.env.GITEA_TOKEN = 'test-token';
    const { provider: giteaProvider } = await import('@remogram/provider-gitea-api');
    const { logs } = await captureCliOutput(() =>
      runCli(['doctor', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': giteaProvider },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(true);
    const writeCheck = packet.checks.find((c) => c.name === 'write_config');
    expect(writeCheck?.status).toBe('warn');
    expect(writeCheck?.message).toContain('write_commands');
    expect(packet.write_config.commands.some((entry) => entry.id === 'cr_open' && entry.ready === false)).toBe(
      true,
    );
  });

  it('doctor fails closed when .remogram.json is missing', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'remogram-no-config-'));
    cleanups.push({ cleanup: () => rmSync(dir, { recursive: true, force: true }) });
    const provider = createMockProvider();
    const providers = { 'gitea-api': provider };
    const { logs } = await captureCliOutput(() =>
      runCli(['doctor', '--json'], { cwd: dir, providers }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.type).toBe(PACKET_TYPES.PROVIDER_DOCTOR);
    expect(packet.summary).toBe('fail');
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('config_invalid');
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it('doctor fails closed on config mismatch', async () => {
    const config = { ...defaultTestConfig(), owner: 'wrong-owner' };
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const provider = createMockProvider();
    const providers = { 'gitea-api': provider };
    const { logs } = await captureCliOutput(() =>
      runCli(['doctor', '--json'], { cwd: setup.dir, providers }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.type).toBe(PACKET_TYPES.PROVIDER_DOCTOR);
    expect(packet.summary).toBe('fail');
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('config_invalid');
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it('refs compare', async () => {
    const { cli } = env();
    const { logs } = await cli(['refs', 'compare', '--base', 'main', '--head', 'feat/x']);
    const packet = JSON.parse(logs[0]);
    expectEnvelope(packet);
    expect(packet.type).toBe(PACKET_TYPES.REF_COMPARE);
    expect(packet.compare_base_ref).toBe('main');
    expect(packet.compare_head_ref).toBe('feat/x');
  });

  it('cr inventory', async () => {
    const { cli } = env();
    const { logs } = await cli(['cr', 'inventory']);
    const packet = JSON.parse(logs[0]);
    expectEnvelope(packet);
    expect(packet.type).toBe('cr_inventory_slice');
    expect(packet.entry_count).toBe(1);
    expect(packet).not.toHaveProperty('goal_branch');
    expect(packet).not.toHaveProperty('sdlc_task');
  });

  it('cr inventory without auth returns unauthenticated_provider', async () => {
    const config = defaultTestConfig();
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    delete process.env.GITEA_TOKEN;
    const { logs } = await captureCliOutput(() =>
      runCli(['cr', 'inventory', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': giteaProvider },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.type).toBe('forge_error');
    expect(packet.error_code).toBe('unauthenticated_provider');
  });

  it('cr open without write_commands returns write_not_configured', async () => {
    const config = defaultTestConfig();
    delete config.write_commands;
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const { logs } = await captureCliOutput(() =>
      runCli(
        ['cr', 'open', '--head', 'impl/x', '--base', 'remo', '--title', 'Open CR', '--json'],
        { cwd: setup.dir, providers: { 'gitea-api': createMockProvider() } },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('write_not_configured');
  });

  it('cr open returns change_request_opened via mock provider', async () => {
    const { cli } = env();
    const { logs } = await cli([
      'cr',
      'open',
      '--head',
      'impl/x',
      '--base',
      'remo',
      '--title',
      'Open CR',
    ]);
    const packet = JSON.parse(logs[0]);
    expectEnvelope(packet);
    expect(packet.type).toBe(PACKET_TYPES.CHANGE_REQUEST_OPENED);
    expect(packet.pr_number).toBe(99);
    expect(packet.head).toBe('impl/x');
    expect(packet.base).toBe('remo');
  });

  it('cr open rejects idempotency key reused with different head/base scope', async () => {
    const { cli } = env();
    await cli([
      'cr',
      'open',
      '--head',
      'impl/a',
      '--base',
      'remo',
      '--title',
      'Open CR',
      '--idempotency-key',
      'agent-retry-1',
    ]);
    const { logs } = await cli([
      'cr',
      'open',
      '--head',
      'impl/b',
      '--base',
      'remo',
      '--title',
      'Open CR',
      '--idempotency-key',
      'agent-retry-1',
    ]);
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('idempotency_conflict');
  });

  it('issue open without write_commands returns write_not_configured', async () => {
    const config = defaultTestConfig();
    delete config.write_commands;
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const { logs } = await captureCliOutput(() =>
      runCli(['issue', 'open', '--title', 'Bug', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': createMockProvider() },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('write_not_configured');
  });

  it('issue open returns issue_opened via mock provider', async () => {
    const config = defaultTestConfig({ write_commands: ['issue_open'] });
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const { logs } = await captureCliOutput(() =>
      runCli(['issue', 'open', '--title', 'Bug report', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': createMockProvider() },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expectEnvelope(packet);
    expect(packet.type).toBe(PACKET_TYPES.ISSUE_OPENED);
    expect(packet.issue_number).toBe(55);
    expect(packet.title).toBe('Bug report');
    expect(packet.created).toBe(true);
  });

  it('cr open then cr inventory includes opened pr_number via gitea-api', async () => {
    const config = defaultTestConfig();
    const setup = setupTempForge({
      config,
      remoteUrl: 'http://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    process.env.GITEA_TOKEN = 'test-token';

    const openedPull = {
      number: 278,
      title: 'Open CR',
      state: 'open',
      mergeable: true,
      html_url: 'http://localhost:3000/owner/repo/pulls/278',
      base: { ref: 'remo', sha: 'aaa111' },
      head: { ref: 'impl/x', sha: 'bbb222' },
    };

    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(giteaBranchProtection, 'resolveBranchProtection').mockResolvedValue({
      branch_ref: 'remo',
      required_status_contexts: [],
      protected_branch_rules: [],
      approvals_required: { implemented: false, count: null },
    });
    try {
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
          status: 201,
          body: {
            [Symbol.asyncIterator]: async function* () {
              yield Buffer.from(JSON.stringify(openedPull));
            },
          },
        });

      const { logs: openLogs } = await captureCliOutput(() =>
        runCli(['cr', 'open', '--head', 'impl/x', '--base', 'remo', '--title', 'Open CR', '--json'], {
          cwd: setup.dir,
          providers: { 'gitea-api': giteaProvider },
        }),
      );
      const opened = JSON.parse(openLogs[0]);
      expect(opened.type).toBe(PACKET_TYPES.CHANGE_REQUEST_OPENED);
      expect(opened.pr_number).toBe(278);

      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['X-Total-Count', '1']]),
          body: {
            [Symbol.asyncIterator]: async function* () {
              yield Buffer.from(JSON.stringify([{ number: 278, state: 'open' }]));
            },
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          body: {
            [Symbol.asyncIterator]: async function* () {
              yield Buffer.from(JSON.stringify(openedPull));
            },
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          body: {
            [Symbol.asyncIterator]: async function* () {
              yield Buffer.from(JSON.stringify(openedPull));
            },
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          body: {
            [Symbol.asyncIterator]: async function* () {
              yield Buffer.from('[]');
            },
          },
        });

      const { logs: inventoryLogs } = await captureCliOutput(() =>
        runCli(['cr', 'inventory', '--json'], {
          cwd: setup.dir,
          providers: { 'gitea-api': giteaProvider },
        }),
      );
      const inventory = JSON.parse(inventoryLogs[0]);
      expect(inventory.type).toBe('cr_inventory_slice');
      expect(inventory.ok).toBe(true);
      expect(inventory.entries.some((entry) => entry.pr_number === 278)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('cr open fails closed with idempotency_scan metadata when scan is truncated', async () => {
    const config = defaultTestConfig();
    config.write_commands = ['cr_open'];
    const setup = setupTempForge({
      config,
      remoteUrl: 'http://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    process.env.GITEA_TOKEN = 'test-token';

    const { MAX_OPEN_PULL_IDEMPOTENCY_PAGES, DEFAULT_OPEN_PULL_LIST_PAGE_SIZE } =
      await import('@remogram/core');

    function mismatchPage(count) {
      return Array.from({ length: count }, (_, i) => ({
        number: i + 1,
        state: 'open',
        head: { ref: 'other-head' },
        base: { ref: 'remo' },
      }));
    }

    vi.stubGlobal('fetch', vi.fn());
    try {
      for (let page = 0; page < MAX_OPEN_PULL_IDEMPOTENCY_PAGES; page += 1) {
        global.fetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          body: {
            [Symbol.asyncIterator]: async function* () {
              yield Buffer.from(
                JSON.stringify(mismatchPage(DEFAULT_OPEN_PULL_LIST_PAGE_SIZE)),
              );
            },
          },
        });
      }
      const { logs } = await captureCliOutput(() =>
        runCli(['cr', 'open', '--head', 'feat/x', '--base', 'remo', '--title', 'T', '--json'], {
          cwd: setup.dir,
          providers: { 'gitea-api': giteaProvider },
        }),
      );
      const packet = JSON.parse(logs[0]);
      expect(packet.ok).toBe(false);
      expect(packet.type).toBe('forge_error');
      expect(packet.error_code).toBe('idempotency_scan_incomplete');
      expect(packet.idempotency_scan).toEqual({
        pages: MAX_OPEN_PULL_IDEMPOTENCY_PAGES,
        max_pages: MAX_OPEN_PULL_IDEMPOTENCY_PAGES,
        page_size: DEFAULT_OPEN_PULL_LIST_PAGE_SIZE,
      });
      expect(global.fetch.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('cr open idempotency scan uses ingest backoff at default ingest cap', async () => {
    delete process.env.REMOGRAM_FORGE_INGEST_MAX_BYTES;
    const config = defaultTestConfig();
    config.write_commands = ['cr_open'];
    const setup = setupTempForge({
      config,
      remoteUrl: 'http://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    process.env.GITEA_TOKEN = 'test-token';

    const paddedPulls = Array.from({ length: 25 }, (_, i) => ({
      number: i + 1,
      state: 'open',
      title: 'z'.repeat(400),
      head: { ref: 'other-head' },
      base: { ref: 'remo' },
    }));
    const oversizedJson = JSON.stringify(paddedPulls);
    expect(Buffer.byteLength(oversizedJson, 'utf8')).toBeGreaterThan(8192);

    vi.stubGlobal('fetch', vi.fn());
    try {
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
                    number: 401,
                    html_url: 'http://localhost:3000/owner/repo/pulls/401',
                    title: 'T',
                  }),
                );
              },
            },
          });
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
        return Promise.resolve({
          ok: true,
          status: 200,
          body: {
            [Symbol.asyncIterator]: async function* () {
              yield Buffer.from('[]');
            },
          },
        });
      });

      const { logs } = await captureCliOutput(() =>
        runCli(['cr', 'open', '--head', 'feat/x', '--base', 'remo', '--title', 'T', '--json'], {
          cwd: setup.dir,
          providers: { 'gitea-api': giteaProvider },
        }),
      );
      const packet = JSON.parse(logs[0]);
      expect(packet.ok).toBe(true);
      expect(packet.type).toBe(PACKET_TYPES.CHANGE_REQUEST_OPENED);
      expect(packet.pr_number).toBe(401);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('cr open without provider support returns provider_unsupported', async () => {
    const config = defaultTestConfig({
      provider: 'github-api',
      baseUrl: 'https://github.com',
    });
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://github.com/owner/repo.git',
    });
    cleanups.push(setup);
    process.env.GITHUB_TOKEN = 'test-token';
    const { provider: githubProvider } = await import('@remogram/provider-github-api');
    const { logs } = await captureCliOutput(() =>
      runCli(
        ['cr', 'open', '--head', 'feat', '--base', 'main', '--title', 'T', '--json'],
        { cwd: setup.dir, providers: { 'github-api': githubProvider } },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('provider_unsupported');
  });

  it('pr view', async () => {
    const { cli } = env();
    const { logs } = await cli(['pr', 'view', '--number', '1']);
    const packet = JSON.parse(logs[0]);
    expectEnvelope(packet);
    expect(packet.type).toBe(PACKET_TYPES.PR_STATUS);
    expect(packet.pr_number).toBe(1);
  });

  it('pr checks', async () => {
    const { cli } = env();
    const { logs } = await cli(['pr', 'checks', '--number', '1']);
    const packet = JSON.parse(logs[0]);
    expectEnvelope(packet);
    expect(packet.type).toBe(PACKET_TYPES.PR_CHECKS);
    expect(packet.check_conclusion).toBe('success');
  });

  it('merge plan', async () => {
    const { cli } = env();
    const { logs } = await cli(['merge', 'plan', '--number', '1']);
    const packet = JSON.parse(logs[0]);
    expectEnvelope(packet);
    expect(packet.type).toBe(PACKET_TYPES.MERGE_PLAN);
    expect(packet.blockers).toEqual([]);
  });

  it('merge plan clears checks_missing when merge_policy allows missing checks', async () => {
    const config = defaultTestConfig({
      merge_policy: { allow_missing_checks: true, allow_pending_checks: true },
    });
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const mock = createMockProvider({
      mergePlan: async (ctx, { number }) => {
        const view = {
          pr_number: number,
          mergeability: 'clean',
          state: 'open',
        };
        const checks = { check_conclusion: 'missing', checks_truncated: false };
        return buildMergePlanBodyFromFacts(view, checks, { merge_policy: ctx.mergePolicy ?? {} });
      },
    });
    const { logs } = await captureCliOutput(() =>
      runCli(['merge', 'plan', '--number', '1', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': mock },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.type).toBe(PACKET_TYPES.MERGE_PLAN);
    expect(packet.checks_conclusion).toBe('missing');
    expect(packet.blockers).toEqual([]);
  });

  it('doctor warns when merge_policy relaxes check blockers', async () => {
    const config = defaultTestConfig({
      merge_policy: { allow_missing_checks: true },
    });
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const { logs } = await captureCliOutput(() =>
      runCli(['doctor', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': createMockProvider() },
      }),
    );
    const packet = JSON.parse(logs[0]);
    const mergePolicyCheck = packet.checks.find((c) => c.name === 'merge_policy');
    expect(mergePolicyCheck.status).toBe('warn');
    expect(mergePolicyCheck.details.allow_missing_checks).toBe(true);
  });

  const MERGE_BASE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const MERGE_HEAD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  it('merge execute without write_commands returns write_not_configured', async () => {
    const config = defaultTestConfig();
    delete config.write_commands;
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const { logs } = await captureCliOutput(() =>
      runCli(
        [
          'merge',
          'execute',
          '--number',
          '1',
          '--expected-base-sha',
          MERGE_BASE,
          '--expected-head-sha',
          MERGE_HEAD,
          '--json',
        ],
        { cwd: setup.dir, providers: { 'gitea-api': createMockProvider() } },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('write_not_configured');
  });

  it('merge execute returns cr_merged via mock provider', async () => {
    const config = defaultTestConfig({ write_commands: ['merge'] });
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const mergeCommit = 'dddddddddddddddddddddddddddddddddddddddd';
    const mock = createMockProvider({
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        base_sha: MERGE_BASE,
        head_sha: MERGE_HEAD,
        head_ref: 'feat/x',
        mergeability: 'clean',
      }),
      prChecks: async () => ({
        head_sha: MERGE_HEAD,
        check_conclusion: 'success',
        checks_truncated: false,
        statuses: [],
      }),
      branchHeadSha: async () => MERGE_HEAD,
      mergeExecute: async (_ctx, { expectedHeadSha }) => {
        expect(expectedHeadSha).toBe(MERGE_HEAD);
        return {
          commit_sha: mergeCommit,
          provider_status: 200,
        };
      },
    });
    const { logs } = await captureCliOutput(() =>
      runCli(
        [
          'merge',
          'execute',
          '--number',
          '1',
          '--expected-base-sha',
          MERGE_BASE,
          '--expected-head-sha',
          MERGE_HEAD,
          '--method',
          'merge',
          '--json',
        ],
        { cwd: setup.dir, providers: { 'gitea-api': mock } },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expectEnvelope(packet);
    expect(packet.type).toBe(PACKET_TYPES.CR_MERGED);
    expect(packet.ok).toBe(true);
    expect(packet.merge.commit_sha).toBe(mergeCommit);
    expect(packet.before.forge_head_ref_sha).toBe(MERGE_HEAD);
  });

  it('merge execute passes forge_source_repo_id to branchHeadSha', async () => {
    const config = defaultTestConfig({ write_commands: ['merge'] });
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const mergeCommit = 'dddddddddddddddddddddddddddddddddddddddd';
    let branchHeadRepoId = null;
    const mock = createMockProvider({
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        base_sha: MERGE_BASE,
        head_sha: MERGE_HEAD,
        head_ref: 'feat/x',
        forge_source_repo_id: 'forker/fork',
        mergeability: 'clean',
      }),
      prChecks: async () => ({
        head_sha: MERGE_HEAD,
        check_conclusion: 'success',
        checks_truncated: false,
        statuses: [],
      }),
      branchHeadSha: async (_ctx, _branchRef, { repoId } = {}) => {
        branchHeadRepoId = repoId ?? null;
        return MERGE_HEAD;
      },
      mergeExecute: async (_ctx, { expectedHeadSha }) => {
        expect(expectedHeadSha).toBe(MERGE_HEAD);
        return {
          commit_sha: mergeCommit,
          provider_status: 200,
        };
      },
    });
    const { logs } = await captureCliOutput(() =>
      runCli(
        [
          'merge',
          'execute',
          '--number',
          '1',
          '--expected-base-sha',
          MERGE_BASE,
          '--expected-head-sha',
          MERGE_HEAD,
          '--method',
          'merge',
          '--json',
        ],
        { cwd: setup.dir, providers: { 'gitea-api': mock } },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(branchHeadRepoId).toBe('forker/fork');
    expect(packet.type).toBe(PACKET_TYPES.CR_MERGED);
    expect(packet.ok).toBe(true);
  });

  it('merge execute returns cr_merged when merge_policy allows missing checks', async () => {
    const config = defaultTestConfig({
      write_commands: ['merge'],
      merge_policy: { allow_missing_checks: true, allow_pending_checks: true },
    });
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const mergeCommit = 'dddddddddddddddddddddddddddddddddddddddd';
    const mock = createMockProvider({
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        base_sha: MERGE_BASE,
        head_sha: MERGE_HEAD,
        head_ref: 'feat/x',
        mergeability: 'clean',
      }),
      prChecks: async () => ({
        head_sha: MERGE_HEAD,
        check_conclusion: 'pending',
        checks_truncated: false,
        statuses: [],
      }),
      mergePlan: async (ctx, { number }) => {
        const view = {
          pr_number: number,
          state: 'open',
          mergeability: 'clean',
        };
        const checks = { check_conclusion: 'pending', checks_truncated: false };
        return buildMergePlanBodyFromFacts(view, checks, { merge_policy: ctx.mergePolicy ?? {} });
      },
      branchHeadSha: async () => MERGE_HEAD,
      mergeExecute: async () => ({
        commit_sha: mergeCommit,
        provider_status: 200,
      }),
    });
    const { logs } = await captureCliOutput(() =>
      runCli(
        [
          'merge',
          'execute',
          '--number',
          '1',
          '--expected-base-sha',
          MERGE_BASE,
          '--expected-head-sha',
          MERGE_HEAD,
          '--method',
          'merge',
          '--json',
        ],
        { cwd: setup.dir, providers: { 'gitea-api': mock } },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.type).toBe(PACKET_TYPES.CR_MERGED);
    expect(packet.ok).toBe(true);
    expect(packet.before.merge_policy.allow_pending_checks).toBe(true);
  });

  it('merge execute preserves INVALID_ARGS from branchHeadSha repoId validation', async () => {
    const config = defaultTestConfig({ write_commands: ['merge'] });
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const mock = createMockProvider({
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        base_sha: MERGE_BASE,
        head_sha: MERGE_HEAD,
        head_ref: 'feat/x',
        forge_source_repo_id: 'not-owner-repo',
        mergeability: 'clean',
      }),
      prChecks: async () => ({
        head_sha: MERGE_HEAD,
        check_conclusion: 'success',
        checks_truncated: false,
        statuses: [],
      }),
      branchHeadSha: async (_ctx, _branchRef, { repoId } = {}) => {
        const parts = String(repoId ?? '').split('/');
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          throw Object.assign(new Error('Invalid repoId'), {
            forgeError: forgeError(ERROR_CODES.INVALID_ARGS, 'repoId must be owner/repo'),
          });
        }
        return MERGE_HEAD;
      },
    });
    const { logs } = await captureCliOutput(() =>
      runCli(
        [
          'merge',
          'execute',
          '--number',
          '1',
          '--expected-base-sha',
          MERGE_BASE,
          '--expected-head-sha',
          MERGE_HEAD,
          '--method',
          'merge',
          '--json',
        ],
        { cwd: setup.dir, providers: { 'gitea-api': mock } },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('invalid_args');
    expect(packet.type).not.toBe(PACKET_TYPES.CR_MERGE_BLOCKED);
  });

  it('merge execute blocks with head_ref_moved when forge branch tip differs', async () => {
    const config = defaultTestConfig({ write_commands: ['merge'] });
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const movedSha = 'cccccccccccccccccccccccccccccccccccccccc';
    const mock = createMockProvider({
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        base_sha: MERGE_BASE,
        head_sha: MERGE_HEAD,
        head_ref: 'feat/x',
        mergeability: 'clean',
      }),
      prChecks: async () => ({
        head_sha: MERGE_HEAD,
        check_conclusion: 'success',
        checks_truncated: false,
        statuses: [],
      }),
      branchHeadSha: async () => movedSha,
    });
    const { logs } = await captureCliOutput(() =>
      runCli(
        [
          'merge',
          'execute',
          '--number',
          '1',
          '--expected-base-sha',
          MERGE_BASE,
          '--expected-head-sha',
          MERGE_HEAD,
          '--json',
        ],
        { cwd: setup.dir, providers: { 'gitea-api': mock } },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.type).toBe(PACKET_TYPES.CR_MERGE_BLOCKED);
    expect(packet.blockers).toContain('head_ref_moved');
    expect(packet.blockers).toContain('forge_pr_head_mismatch');
    expect(packet.before.forge_head_ref_sha).toBe(movedSha);
  });

  it('merge execute blocks with head_ref_unreadable when forge branch read fails', async () => {
    const config = defaultTestConfig({ write_commands: ['merge'] });
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const mock = createMockProvider({
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        base_sha: MERGE_BASE,
        head_sha: MERGE_HEAD,
        head_ref: 'missing-branch',
        mergeability: 'clean',
      }),
      prChecks: async () => ({
        head_sha: MERGE_HEAD,
        check_conclusion: 'success',
        checks_truncated: false,
        statuses: [],
      }),
    });
    const { logs } = await captureCliOutput(() =>
      runCli(
        [
          'merge',
          'execute',
          '--number',
          '1',
          '--expected-base-sha',
          MERGE_BASE,
          '--expected-head-sha',
          MERGE_HEAD,
          '--json',
        ],
        { cwd: setup.dir, providers: { 'gitea-api': mock } },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.type).toBe(PACKET_TYPES.CR_MERGE_BLOCKED);
    expect(packet.blockers).toContain('head_ref_unreadable');
    expect(packet.before.forge_head_ref_sha).toBeNull();
  });

  it('merge execute blocks with checks_head_sha_mismatch when checks diverge from view', async () => {
    const config = defaultTestConfig({ write_commands: ['merge'] });
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const checksSha = 'cccccccccccccccccccccccccccccccccccccccc';
    let mergeCalled = false;
    const mock = createMockProvider({
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        base_sha: MERGE_BASE,
        head_sha: MERGE_HEAD,
        head_ref: 'feat/x',
        mergeability: 'clean',
      }),
      prChecks: async () => ({
        head_sha: checksSha,
        check_conclusion: 'success',
        checks_truncated: false,
        statuses: [],
      }),
      branchHeadSha: async () => MERGE_HEAD,
      mergeExecute: async () => {
        mergeCalled = true;
        return { commit_sha: checksSha, provider_status: 200 };
      },
    });
    const { logs } = await captureCliOutput(() =>
      runCli(
        [
          'merge',
          'execute',
          '--number',
          '1',
          '--expected-base-sha',
          MERGE_BASE,
          '--expected-head-sha',
          MERGE_HEAD,
          '--json',
        ],
        { cwd: setup.dir, providers: { 'gitea-api': mock } },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.type).toBe(PACKET_TYPES.CR_MERGE_BLOCKED);
    expect(packet.blockers).toContain('checks_head_sha_mismatch');
    expect(packet.before.checks_head_sha).toBe(checksSha);
    expect(mergeCalled).toBe(false);
  });

  it('merge execute blocks with head_ref_unverified when branchHeadSha is missing', async () => {
    const config = defaultTestConfig({ write_commands: ['merge'] });
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const mock = createMockProvider({
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        base_sha: MERGE_BASE,
        head_sha: MERGE_HEAD,
        head_ref: 'feat/x',
        mergeability: 'clean',
      }),
      prChecks: async () => ({
        head_sha: MERGE_HEAD,
        check_conclusion: 'success',
        checks_truncated: false,
        statuses: [],
      }),
    });
    delete mock.branchHeadSha;
    const { logs } = await captureCliOutput(() =>
      runCli(
        [
          'merge',
          'execute',
          '--number',
          '1',
          '--expected-base-sha',
          MERGE_BASE,
          '--expected-head-sha',
          MERGE_HEAD,
          '--json',
        ],
        { cwd: setup.dir, providers: { 'gitea-api': mock } },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.type).toBe(PACKET_TYPES.CR_MERGE_BLOCKED);
    expect(packet.blockers).toContain('head_ref_unverified');
  });

  it('merge execute blocks with head_ref_invalid for invalid forge head_ref', async () => {
    const config = defaultTestConfig({ write_commands: ['merge'] });
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const mock = createMockProvider({
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        base_sha: MERGE_BASE,
        head_sha: MERGE_HEAD,
        head_ref: '../evil',
        mergeability: 'clean',
      }),
      prChecks: async () => ({
        head_sha: MERGE_HEAD,
        check_conclusion: 'success',
        checks_truncated: false,
        statuses: [],
      }),
    });
    const { logs } = await captureCliOutput(() =>
      runCli(
        [
          'merge',
          'execute',
          '--number',
          '1',
          '--expected-base-sha',
          MERGE_BASE,
          '--expected-head-sha',
          MERGE_HEAD,
          '--json',
        ],
        { cwd: setup.dir, providers: { 'gitea-api': mock } },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.type).toBe(PACKET_TYPES.CR_MERGE_BLOCKED);
    expect(packet.blockers).toContain('head_ref_invalid');
    expect(packet.error_code).toBe('invalid_args');
  });

  it('merge execute blocks with head_ref_missing when open PR has no head_ref', async () => {
    const config = defaultTestConfig({ write_commands: ['merge'] });
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const mock = createMockProvider({
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        base_sha: MERGE_BASE,
        head_sha: MERGE_HEAD,
        mergeability: 'clean',
      }),
      prChecks: async () => ({
        head_sha: MERGE_HEAD,
        check_conclusion: 'success',
        checks_truncated: false,
        statuses: [],
      }),
    });
    const { logs } = await captureCliOutput(() =>
      runCli(
        [
          'merge',
          'execute',
          '--number',
          '1',
          '--expected-base-sha',
          MERGE_BASE,
          '--expected-head-sha',
          MERGE_HEAD,
          '--json',
        ],
        { cwd: setup.dir, providers: { 'gitea-api': mock } },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.type).toBe(PACKET_TYPES.CR_MERGE_BLOCKED);
    expect(packet.blockers).toContain('head_ref_missing');
  });

  it('merge execute returns invalid_args for malformed expected head SHA', async () => {
    const config = defaultTestConfig({ write_commands: ['merge'] });
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const { logs } = await captureCliOutput(() =>
      runCli(
        [
          'merge',
          'execute',
          '--number',
          '1',
          '--expected-base-sha',
          MERGE_BASE,
          '--expected-head-sha',
          'short',
          '--json',
        ],
        { cwd: setup.dir, providers: { 'gitea-api': createMockProvider() } },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.type).toBe('forge_error');
    expect(packet.error_code).toBe('invalid_args');
  });

  it('merge execute blocks with head_ref_moved when forge POST rejects head_commit_id pin', async () => {
    const config = defaultTestConfig({ write_commands: ['merge'] });
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const mock = createMockProvider({
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        base_sha: MERGE_BASE,
        head_sha: MERGE_HEAD,
        head_ref: 'feat/x',
        mergeability: 'clean',
      }),
      prChecks: async () => ({
        head_sha: MERGE_HEAD,
        check_conclusion: 'success',
        checks_truncated: false,
        statuses: [],
      }),
      branchHeadSha: async () => MERGE_HEAD,
      mergeExecute: async (_ctx, { expectedHeadSha }) => {
        expect(expectedHeadSha).toBe(MERGE_HEAD);
        throw Object.assign(new Error('head out of date'), {
          status: 409,
          mergeBlockedBlockers: ['head_ref_moved'],
          forgeError: {
            code: 'merge_blocked',
            message: 'head out of date',
            status: 409,
          },
        });
      },
    });
    const { logs } = await captureCliOutput(() =>
      runCli(
        [
          'merge',
          'execute',
          '--number',
          '1',
          '--expected-base-sha',
          MERGE_BASE,
          '--expected-head-sha',
          MERGE_HEAD,
          '--json',
        ],
        { cwd: setup.dir, providers: { 'gitea-api': mock } },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.type).toBe(PACKET_TYPES.CR_MERGE_BLOCKED);
    expect(packet.blockers).toContain('head_ref_moved');
    expect(packet.error_code).toBe('merge_blocked');
  });

  it('merge execute keeps merge_endpoint_failed for non-pin forge 409 errors', async () => {
    const config = defaultTestConfig({ write_commands: ['merge'] });
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const mock = createMockProvider({
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        base_sha: MERGE_BASE,
        head_sha: MERGE_HEAD,
        head_ref: 'feat/x',
        mergeability: 'clean',
      }),
      prChecks: async () => ({
        head_sha: MERGE_HEAD,
        check_conclusion: 'success',
        checks_truncated: false,
        statuses: [],
      }),
      branchHeadSha: async () => MERGE_HEAD,
      mergeExecute: async () => {
        throw Object.assign(new Error('merge conflict'), {
          status: 409,
          forgeError: {
            code: 'api_error',
            message: 'merge conflict',
            status: 409,
          },
        });
      },
    });
    const { logs } = await captureCliOutput(() =>
      runCli(
        [
          'merge',
          'execute',
          '--number',
          '1',
          '--expected-base-sha',
          MERGE_BASE,
          '--expected-head-sha',
          MERGE_HEAD,
          '--json',
        ],
        { cwd: setup.dir, providers: { 'gitea-api': mock } },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.type).toBe(PACKET_TYPES.CR_MERGE_BLOCKED);
    expect(packet.blockers).toContain('merge_endpoint_failed');
    expect(packet.error_code).toBe('api_error');
  });

  it('sync plan', async () => {
    const { cli } = env();
    const { logs } = await cli(['sync', 'plan', '--remote', 'origin']);
    const packet = JSON.parse(logs[0]);
    expectEnvelope(packet);
    expect(packet.type).toBe(PACKET_TYPES.SYNC_PLAN);
    expect(packet.remote).toBe('origin');
  });

  it('returns forge_error for unknown command', async () => {
    const { cli } = env();
    const { logs } = await cli(['bogus', 'cmd']);
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.type).toBe('forge_error');
  });
});
