import { describe, it, expect, afterEach } from 'vitest';
import { runCli } from '@remogram/cli';
import { PACKET_TYPES, SCHEMA_VERSION } from '@remogram/core';
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

  it('refs compare', async () => {
    const { cli } = env();
    const { logs } = await cli(['refs', 'compare', '--base', 'main', '--head', 'feat/x']);
    const packet = JSON.parse(logs[0]);
    expectEnvelope(packet);
    expect(packet.type).toBe(PACKET_TYPES.REF_COMPARE);
    expect(packet.base_ref).toBe('main');
    expect(packet.head_ref).toBe('feat/x');
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
