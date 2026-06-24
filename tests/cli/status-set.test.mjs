import { describe, it, expect, afterEach } from 'vitest';
import { runCli } from '@remogram/cli';
import { PACKET_TYPES, SCHEMA_VERSION } from '@remogram/core';
import { setupTempForge, captureCliOutput } from '../helpers/temp-forge.mjs';
import { createMockProvider, defaultTestConfig } from '../helpers/mock-provider.mjs';

const SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('remogram status set', () => {
  /** @type {ReturnType<typeof setupTempForge>[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop().cleanup();
    delete process.env.GITEA_TOKEN;
    delete process.env.REMOGRAM_OPERATOR_CONFIG;
  });

  function env(overrides = {}) {
    const config = defaultTestConfig(overrides);
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
    return { cli, setup, provider };
  }

  function expectEnvelope(packet) {
    expect(packet.schema_version).toBe(SCHEMA_VERSION);
    expect(packet.provider_id).toBe('gitea-api');
    expect(packet.remote_name).toBe('origin');
    expect(packet.repo_id).toBe('owner/repo');
    expect(packet.observed_at).toMatch(/^\d{4}-/);
    expect(typeof packet.ok).toBe('boolean');
  }

  it('status set without write_commands returns write_not_configured', async () => {
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
          'status',
          'set',
          '--sha',
          SHA,
          '--context',
          'verify/wave1',
          '--state',
          'success',
          '--json',
        ],
        { cwd: setup.dir, providers: { 'gitea-api': createMockProvider() } },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('write_not_configured');
  });

  it('status set rejects missing required args', async () => {
    const { cli } = env({ write_commands: ['status_set'] });
    const { logs } = await cli(['status', 'set', '--sha', SHA, '--context', 'verify/wave1']);
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('invalid_args');
  });

  it('status set rejects invalid sha', async () => {
    const { cli } = env({ write_commands: ['status_set'] });
    const { logs } = await cli([
      'status',
      'set',
      '--sha',
      'abc123',
      '--context',
      'verify/wave1',
      '--state',
      'success',
    ]);
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('invalid_args');
  });

  it('status set returns commit_status_set via mock provider', async () => {
    const { cli } = env({ write_commands: ['status_set'] });
    const { logs } = await cli([
      'status',
      'set',
      '--sha',
      SHA,
      '--context',
      'verify/wave1',
      '--state',
      'success',
      '--description',
      'Verification passed',
    ]);
    const packet = JSON.parse(logs[0]);
    expectEnvelope(packet);
    expect(packet.type).toBe(PACKET_TYPES.COMMIT_STATUS_SET);
    expect(packet.sha).toBe(SHA);
    expect(packet.context).toBe('verify/wave1');
    expect(packet.state).toBe('success');
    expect(packet.description).toBe('Verification passed');
  });

  it('status set without provider support returns provider_unsupported', async () => {
    const config = defaultTestConfig({ write_commands: ['status_set'], provider: 'gitea-tea' });
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const { logs } = await captureCliOutput(() =>
      runCli(
        [
          'status',
          'set',
          '--sha',
          SHA,
          '--context',
          'verify/wave1',
          '--state',
          'success',
          '--json',
        ],
        { cwd: setup.dir },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('provider_unsupported');
  });
});
