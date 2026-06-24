import { describe, it, expect, afterEach } from 'vitest';
import { runCli } from '@remogram/cli';
import { PACKET_TYPES, buildMergePlanFromProviderFacts } from '@remogram/core';
import { setupTempForge, captureCliOutput } from '../helpers/temp-forge.mjs';
import { createMockProvider, defaultTestConfig } from '../helpers/mock-provider.mjs';

function createOrchestrationMockProvider(overrides = {}) {
  const base = createMockProvider(overrides);
  return {
    ...base,
    mergePlan: async (ctx, opts) =>
      buildMergePlanFromProviderFacts(ctx, opts, {
        prView: (c, o) => base.prView(c, o),
        prChecks: (c, o) => base.prChecks(c, o),
        crFiles: (c, o) => base.crFiles(c, o),
      }),
  };
}

describe('merge plan path scope CLI', () => {
  /** @type {ReturnType<typeof setupTempForge>[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop().cleanup();
    delete process.env.GITEA_TOKEN;
  });

  it('evaluates path scope with orchestrated merge plan and allowlist', async () => {
    process.env.GITEA_TOKEN = 'test-token';
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const { logs } = await captureCliOutput(() =>
      runCli(
        ['merge', 'plan', '--number', '1', '--allowed-path', 'packages/**', '--json'],
        {
          cwd: setup.dir,
          providers: { 'gitea-api': createOrchestrationMockProvider() },
        },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.type).toBe(PACKET_TYPES.MERGE_PLAN);
    expect(packet.ok).toBe(true);
    expect(packet.blockers).not.toContain('changed_paths_unavailable');
    expect(packet.blockers).not.toContain('path_scope_violation');
  });

  it('fails closed without token when allowlist is set', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    delete process.env.GITEA_TOKEN;
    const { logs } = await captureCliOutput(() =>
      runCli(
        ['merge', 'plan', '--number', '1', '--allowed-path', 'packages/**', '--json'],
        {
          cwd: setup.dir,
          providers: {
            'gitea-api': createOrchestrationMockProvider({
              crFiles: async () => {
                throw Object.assign(new Error('GITEA_TOKEN not set'), {
                  forgeError: { code: 'unauthenticated_provider', message: 'GITEA_TOKEN not set' },
                });
              },
            }),
          },
        },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('unauthenticated_provider');
  });

  it('ignores whitespace-only allowed-path flags', async () => {
    process.env.GITEA_TOKEN = 'test-token';
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const { logs } = await captureCliOutput(() =>
      runCli(
        ['merge', 'plan', '--number', '1', '--allowed-path', '   ', '--json'],
        {
          cwd: setup.dir,
          providers: { 'gitea-api': createMockProvider() },
        },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.type).toBe(PACKET_TYPES.MERGE_PLAN);
    expect(packet.ok).toBe(true);
    expect(packet.blockers).toEqual([]);
  });
});
