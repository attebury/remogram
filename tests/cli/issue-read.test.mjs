import { describe, it, expect, afterEach } from 'vitest';
import { runCli } from '@remogram/cli';
import { PACKET_TYPES } from '@remogram/core';
import { setupTempForge, captureCliOutput } from '../helpers/temp-forge.mjs';
import { createMockProvider, defaultTestConfig } from '../helpers/mock-provider.mjs';

describe('issue read CLI', () => {
  /** @type {ReturnType<typeof setupTempForge>[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop().cleanup();
    delete process.env.GITEA_TOKEN;
  });

  it('returns issue_status for issue view', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const { logs } = await captureCliOutput(() =>
      runCli(['issue', 'view', '--number', '7', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': createMockProvider() },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.type).toBe(PACKET_TYPES.ISSUE_STATUS);
    expect(packet.issue_number).toBe(7);
    expect(packet.ok).toBe(true);
  });

  it('returns issue_inventory_slice for issue inventory', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const { logs } = await captureCliOutput(() =>
      runCli(['issue', 'inventory', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': createMockProvider() },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.type).toBe(PACKET_TYPES.ISSUE_INVENTORY_SLICE);
    expect(packet.entries[0].issue_number).toBe(1);
  });

  it('returns issue_comments for issue comments', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const { logs } = await captureCliOutput(() =>
      runCli(['issue', 'comments', '--number', '7', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': createMockProvider() },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.type).toBe(PACKET_TYPES.ISSUE_COMMENTS);
    expect(packet.issue_number).toBe(7);
    expect(packet.comment_count).toBe(1);
  });

  it('returns provider_unsupported for non-gitea issue reads', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig({ provider: 'github-api', baseUrl: 'https://github.com' }),
      remoteUrl: 'https://github.com/owner/repo.git',
    });
    cleanups.push(setup);
    const { logs } = await captureCliOutput(() =>
      runCli(['issue', 'view', '--number', '1', '--json'], {
        cwd: setup.dir,
        providers: { 'github-api': createMockProvider({ issueView: undefined }) },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('provider_unsupported');
  });
});
