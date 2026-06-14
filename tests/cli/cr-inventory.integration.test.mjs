import { describe, it, expect, afterEach } from 'vitest';
import { runCli } from '@remogram/cli';
import { FORBIDDEN_PACKET_KEYS, SCHEMA_VERSION } from '@remogram/core';
import { setupTempForge, captureCliOutput } from '../helpers/temp-forge.mjs';
import { defaultTestConfig } from '../helpers/mock-provider.mjs';
import { createCrInventoryHookProvider } from '../helpers/cr-inventory-hook-provider.mjs';

describe('cr inventory CLI integration', () => {
  /** @type {ReturnType<typeof setupTempForge>[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop().cleanup();
  });

  it('aggregates via real crInventory hooks with two forge calls per entry', async () => {
    let viewCalls = 0;
    let checksCalls = 0;
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'http://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);

    const provider = createCrInventoryHookProvider({
      listOpenPulls: async () => [1, 2],
      prView: async (_ctx, { number }) => {
        viewCalls += 1;
        return {
          pr_number: number,
          state: 'open',
          base_sha: 'aaa111',
          head_sha: 'bbb222',
          mergeability: 'clean',
        };
      },
      prChecks: async () => {
        checksCalls += 1;
        return { check_conclusion: 'success', statuses: [] };
      },
    });

    const { logs } = await captureCliOutput(() =>
      runCli(['cr', 'inventory', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': provider },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.type).toBe('cr_inventory_slice');
    expect(packet.ok).toBe(true);
    expect(packet.schema_version).toBe(SCHEMA_VERSION);
    expect(packet.entries).toHaveLength(2);
    expect(packet.entry_count).toBe(2);
    expect(packet.truncated).toBe(false);
    expect(packet.entries[0].head_reconcile).toEqual({ stale: false });
    expect(viewCalls).toBe(2);
    expect(checksCalls).toBe(2);
  });

  it('honors --limit and reports truncated metadata', async () => {
    const numbers = Array.from({ length: 15 }, (_, i) => i + 1);
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'http://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);

    const provider = createCrInventoryHookProvider({
      listOpenPulls: async () => numbers,
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        mergeability: 'clean',
      }),
      prChecks: async () => ({ check_conclusion: 'success', statuses: [] }),
    });

    const { logs } = await captureCliOutput(() =>
      runCli(['cr', 'inventory', '--limit', '10', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': provider },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.truncated).toBe(true);
    expect(packet.entry_count).toBe(15);
    expect(packet.entries).toHaveLength(10);
  });

  it('cr inventory --limit 1 passes list limit to provider before aggregation', async () => {
    let listLimit;
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'http://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);

    const provider = createCrInventoryHookProvider({
      listOpenPullsWithMeta: async (_ctx, opts) => {
        listLimit = opts?.limit;
        return { numbers: [1], list_truncated: false };
      },
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        mergeability: 'clean',
      }),
      prChecks: async () => ({ check_conclusion: 'success', statuses: [] }),
    });

    const { logs } = await captureCliOutput(() =>
      runCli(['cr', 'inventory', '--limit', '1', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': provider },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(true);
    expect(listLimit).toBe(1);
    expect(packet.entries).toHaveLength(1);
  });

  it('emits no forbidden workflow keys in successful CLI packet', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'http://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);

    const provider = createCrInventoryHookProvider();
    const { logs } = await captureCliOutput(() =>
      runCli(['cr', 'inventory', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': provider },
      }),
    );
    const packet = JSON.parse(logs[0]);
    for (const forbidden of FORBIDDEN_PACKET_KEYS) {
      expect(packet).not.toHaveProperty(forbidden);
    }
  });
});
