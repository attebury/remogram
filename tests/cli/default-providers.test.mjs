import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runCli } from '@remogram/cli';
import { setupTempForge, captureCliOutput } from '../helpers/temp-forge.mjs';

function clearForgeTokens() {
  delete process.env.GITEA_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.GITLAB_TOKEN;
}

describe('CLI default PROVIDERS map', () => {
  /** @type {ReturnType<typeof setupTempForge>[]} */
  const cleanups = [];

  beforeEach(clearForgeTokens);

  afterEach(() => {
    while (cleanups.length) cleanups.pop().cleanup();
    clearForgeTokens();
  });

  it('uses default PROVIDERS for github-api without options.providers', async () => {
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
      runCli(['repo', 'status', '--json'], { cwd: setup.dir }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(true);
    expect(packet.type).toBe('repo_status');
    expect(packet.auth_present).toBe(false);
    expect(packet.capabilities).toEqual(['repo_status']);
    expect(packet.provider_id).toBe('github-api');
  });

  it('uses default PROVIDERS for gitlab-api without options.providers', async () => {
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
      runCli(['repo', 'status', '--json'], { cwd: setup.dir }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(true);
    expect(packet.type).toBe('repo_status');
    expect(packet.auth_present).toBe(false);
    expect(packet.capabilities).toEqual(['repo_status']);
    expect(packet.provider_id).toBe('gitlab-api');
  });
});
