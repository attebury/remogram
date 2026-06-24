import { describe, it, expect, afterEach } from 'vitest';
import { runCli } from '@remogram/cli';
import { PACKET_TYPES, SCHEMA_VERSION } from '@remogram/core';
import { setupTempForge, captureCliOutput } from '../helpers/temp-forge.mjs';

describe('CLI real-provider integration', () => {
  /** @type {ReturnType<typeof setupTempForge>[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop().cleanup();
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GITLAB_TOKEN;
    delete process.env.GITEA_TOKEN;
  });

  function expectEnvelope(packet, providerId) {
    expect(packet.schema_version).toBe(SCHEMA_VERSION);
    expect(packet.provider_id).toBe(providerId);
    expect(packet.remote_name).toBe('origin');
    expect(packet.repo_id).toBe('owner/repo');
    expect(packet.observed_at).toMatch(/^\d{4}-/);
    expect(typeof packet.ok).toBe('boolean');
  }

  it('github-api sync plan via default PROVIDERS', async () => {
    const setup = setupTempForge({
      config: {
        version: '1',
        provider: 'github-api',
        owner: 'owner',
        repo: 'repo',
        baseUrl: 'https://github.com',
        remote: 'origin',
      },
      remoteUrl: 'https://github.com/owner/repo.git',
    });
    cleanups.push(setup);

    const { logs } = await captureCliOutput(() =>
      runCli(['sync', 'plan', '--remote', 'origin', '--json'], { cwd: setup.dir }),
    );
    const packet = JSON.parse(logs[0]);
    expectEnvelope(packet, 'github-api');
    expect(packet.type).toBe(PACKET_TYPES.SYNC_PLAN);
    expect(packet.ok).toBe(true);
    expect(packet.blockers).toContain('missing_remote_ref');
  });

  it('gitlab-api sync plan via default PROVIDERS', async () => {
    const setup = setupTempForge({
      config: {
        version: '1',
        provider: 'gitlab-api',
        owner: 'owner',
        repo: 'repo',
        baseUrl: 'https://gitlab.com',
        remote: 'origin',
      },
      remoteUrl: 'https://gitlab.com/owner/repo.git',
    });
    cleanups.push(setup);

    const { logs } = await captureCliOutput(() =>
      runCli(['sync', 'plan', '--remote', 'origin', '--json'], { cwd: setup.dir }),
    );
    const packet = JSON.parse(logs[0]);
    expectEnvelope(packet, 'gitlab-api');
    expect(packet.type).toBe(PACKET_TYPES.SYNC_PLAN);
    expect(packet.ok).toBe(true);
  });
});
