import { describe, it, expect, afterEach } from 'vitest';
import { runCli } from '@remogram/cli';
import { PACKET_TYPES } from '@remogram/core';
import { setupTempForge, captureCliOutput } from '../helpers/temp-forge.mjs';
import { createMockProvider, defaultTestConfig } from '../helpers/mock-provider.mjs';

describe('branch protection CLI', () => {
  /** @type {ReturnType<typeof setupTempForge>[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop().cleanup();
    delete process.env.GITEA_TOKEN;
  });

  it('returns branch_protection via mock provider', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const { logs } = await captureCliOutput(() =>
      runCli(['branch', 'protection', '--branch-ref', 'remo', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': createMockProvider() },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.type).toBe(PACKET_TYPES.BRANCH_PROTECTION);
    expect(packet.ok).toBe(true);
    expect(packet.branch_ref).toBe('remo');
    expect(packet.required_status_contexts).toEqual(['ci/test']);
    expect(packet.protected_branch_rules).toEqual([{ name: 'remo' }]);
    expect(packet.approvals_required).toEqual({ implemented: true, count: 1 });
  });

  it('fails closed without token', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    delete process.env.GITEA_TOKEN;
    const { logs } = await captureCliOutput(() =>
      runCli(['branch', 'protection', '--branch-ref', 'remo', '--json'], {
        cwd: setup.dir,
        providers: {
          'gitea-api': createMockProvider({
            branchProtection: async () => {
              throw Object.assign(new Error('GITEA_TOKEN not set'), {
                forgeError: { code: 'unauthenticated_provider', message: 'GITEA_TOKEN not set' },
              });
            },
          }),
        },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('unauthenticated_provider');
  });

  it('requires --branch-ref', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const { logs } = await captureCliOutput(() =>
      runCli(['branch', 'protection', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': createMockProvider() },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('invalid_args');
  });
});
