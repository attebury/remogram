import { describe, it, expect, afterEach } from 'vitest';
import { runCli } from '@remogram/cli';
import { PACKET_TYPES } from '@remogram/core';
import { setupTempForge, captureCliOutput } from '../helpers/temp-forge.mjs';
import { createMockProvider, defaultTestConfig } from '../helpers/mock-provider.mjs';

describe('cr files CLI', () => {
  /** @type {ReturnType<typeof setupTempForge>[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop().cleanup();
    delete process.env.GITEA_TOKEN;
  });

  it('returns cr_files via mock provider', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const { logs } = await captureCliOutput(() =>
      runCli(['cr', 'files', '--number', '7', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': createMockProvider() },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.type).toBe(PACKET_TYPES.CR_FILES);
    expect(packet.ok).toBe(true);
    expect(packet.pr_number).toBe(7);
    expect(packet.changed_paths).toEqual(['packages/remogram-core/foo.js']);
    expect(packet.paths_truncated).toBe(false);
    expect(packet.path_count).toBe(1);
  });

  it('fails closed without token', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    delete process.env.GITEA_TOKEN;
    const { logs } = await captureCliOutput(() =>
      runCli(['cr', 'files', '--number', '1', '--json'], {
        cwd: setup.dir,
        providers: {
          'gitea-api': createMockProvider({
            crFiles: async () => {
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

  it('requires --number', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const { logs } = await captureCliOutput(() =>
      runCli(['cr', 'files', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': createMockProvider() },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('invalid_args');
  });
});
