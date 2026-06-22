import { describe, it, expect, afterEach } from 'vitest';
import { runCli } from '@remogram/cli';
import { PACKET_TYPES } from '@remogram/core';
import { setupTempForge, captureCliOutput } from '../helpers/temp-forge.mjs';
import { createMockProvider, defaultTestConfig } from '../helpers/mock-provider.mjs';

describe('forge changes CLI', () => {
  /** @type {ReturnType<typeof setupTempForge>[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop().cleanup();
    delete process.env.GITEA_TOKEN;
  });

  it('returns forge_changes via mock provider', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const { logs } = await captureCliOutput(() =>
      runCli(['forge', 'changes', '--since', '2024-06-01T12:00:00Z', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': createMockProvider() },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.type).toBe(PACKET_TYPES.FORGE_CHANGES);
    expect(packet.ok).toBe(true);
    expect(packet.since).toBe('2024-06-01T12:00:00.000Z');
    expect(packet.since_kind).toBe('observed_at');
    expect(packet.events).toHaveLength(1);
    expect(packet.events[0].kind).toBe('pr_opened');
    expect(packet.events_truncated).toBe(false);
    expect(packet.event_count).toBe(1);
  });

  it('fails closed without token', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    delete process.env.GITEA_TOKEN;
    const { logs } = await captureCliOutput(() =>
      runCli(['forge', 'changes', '--since', '2024-06-01T12:00:00Z', '--json'], {
        cwd: setup.dir,
        providers: {
          'gitea-api': createMockProvider({
            forgeChanges: async () => {
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

  it('requires --since', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const { logs } = await captureCliOutput(() =>
      runCli(['forge', 'changes', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': createMockProvider() },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('invalid_args');
  });

  it('rejects malformed --since without provider fetch', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const provider = createMockProvider({
      forgeChanges: async () => {
        throw new Error('forgeChanges should not run');
      },
    });
    const { logs } = await captureCliOutput(() =>
      runCli(['forge', 'changes', '--since', 'not-a-date', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': provider },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('invalid_args');
  });

  it('pages forge changes with cursor until complete', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const events = Array.from({ length: 5 }, (_, i) => ({
      kind: 'pr_opened',
      pr_number: i + 1,
      title: `PR ${i + 1}`,
      url: `http://localhost:3000/o/r/pulls/${i + 1}`,
      state: 'open',
    }));
    const provider = createMockProvider({
      forgeChanges: async (_ctx, { since }) => ({
        since,
        since_kind: 'observed_at',
        events,
        events_truncated: false,
        event_count: events.length,
      }),
    });
    const { logs: page1Logs } = await captureCliOutput(() =>
      runCli(['forge', 'changes', '--since', '2024-06-01T12:00:00Z', '--limit', '2', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': provider },
      }),
    );
    const page1 = JSON.parse(page1Logs[0]);
    expect(page1.ok).toBe(true);
    expect(page1.events).toHaveLength(2);
    expect(page1.has_more).toBe(true);
    expect(page1.next_cursor).toBeTruthy();

    const { logs: page2Logs } = await captureCliOutput(() =>
      runCli(['forge', 'changes', '--cursor', page1.next_cursor, '--limit', '2', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': provider },
      }),
    );
    const page2 = JSON.parse(page2Logs[0]);
    expect(page2.ok).toBe(true);
    expect(page2.events).toHaveLength(2);
    expect(page2.has_more).toBe(true);

    const { logs: page3Logs } = await captureCliOutput(() =>
      runCli(['forge', 'changes', '--cursor', page2.next_cursor, '--limit', '2', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': provider },
      }),
    );
    const page3 = JSON.parse(page3Logs[0]);
    expect(page3.ok).toBe(true);
    expect(page3.events).toHaveLength(1);
    expect(page3.has_more).toBe(false);
    expect(page3.complete).toBe(true);
  });
});
