import { describe, it, expect, afterEach } from 'vitest';
import { runCli } from '@remogram/cli';
import { ERROR_CODES } from '@remogram/core';
import { setupTempForge, captureCliOutput } from '../helpers/temp-forge.mjs';

describe('CLI default PROVIDERS map', () => {
  /** @type {ReturnType<typeof setupTempForge>[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop().cleanup();
  });

  it('uses default PROVIDERS for github-api stub without options.providers', async () => {
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
    expect(packet.ok).toBe(false);
    expect(packet.type).toBe('forge_error');
    expect(packet.error_code).toBe(ERROR_CODES.PROVIDER_UNSUPPORTED);
    expect(packet.provider_id).toBe('github-api');
  });
});
