import { describe, it, expect, afterEach, vi } from 'vitest';
import { runCli } from '@remogram/cli';
import { PACKET_TYPES, SCHEMA_VERSION } from '@remogram/core';
import { provider as giteaProvider } from '@remogram/provider-gitea-api';
import { setupTempForge, captureCliOutput } from '../helpers/temp-forge.mjs';
import { createMockProvider, defaultTestConfig } from '../helpers/mock-provider.mjs';

describe('remogram cli commands', () => {
  /** @type {ReturnType<typeof setupTempForge>[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop().cleanup();
    delete process.env.GITEA_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.REMOGRAM_FORGE_INGEST_MAX_BYTES;
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
    expect(packet.write_support).toBe(false);
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
    expect(packet.base_ref).toBe('main');
    expect(packet.head_ref).toBe('feat/x');
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
