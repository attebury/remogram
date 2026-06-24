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
          forge_target_sha: 'aaa111',
          forge_source_sha: 'bbb222',
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

  it('cr inventory --limit 1 completes open list before entry cap', async () => {
    let retainMax;
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'http://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);

    const provider = createCrInventoryHookProvider({
      listOpenPullsWithMeta: async (_ctx, opts) => {
        retainMax = opts?.retain_max;
        return { numbers: [1], entry_count: 2, list_truncated: false };
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
    expect(retainMax).toBe(1);
    expect(packet.entries).toHaveLength(1);
    expect(packet.entry_count).toBe(2);
    expect(packet.truncated).toBe(true);
    expect(packet.list_truncated).toBe(false);
  });

  it('cr inventory default path uses safe entry bound and complete open list', async () => {
    let retainMax;
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'http://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);

    const provider = createCrInventoryHookProvider({
      listOpenPullsWithMeta: async (_ctx, opts) => {
        retainMax = opts?.retain_max;
        return { numbers: [1, 2, 3], entry_count: 5, list_truncated: false };
      },
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        mergeability: 'clean',
      }),
      prChecks: async () => ({ check_conclusion: 'success', statuses: [] }),
    });

    const { logs } = await captureCliOutput(() =>
      runCli(['cr', 'inventory', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': provider },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(true);
    expect(packet.type).toBe('cr_inventory_slice');
    expect(packet.error_code).toBeUndefined();
    expect(retainMax).toBe(3);
    expect(packet.entries).toHaveLength(3);
    expect(packet.truncated).toBe(true);
    expect(packet.list_truncated).toBe(false);
    expect(packet.slice_sort).toBe('number_asc');
  });

  it('cr inventory forwards --sort recent_update to provider', async () => {
    let receivedSort;
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'http://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);

    const provider = createCrInventoryHookProvider({
      listOpenPullsWithMeta: async (_ctx, opts) => {
        receivedSort = opts?.sort;
        return { numbers: [9, 2], entry_count: 2, list_truncated: false, slice_sort: 'recent_update' };
      },
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        mergeability: 'clean',
      }),
      prChecks: async () => ({ check_conclusion: 'success', statuses: [] }),
    });

    const { logs } = await captureCliOutput(() =>
      runCli(['cr', 'inventory', '--limit', '2', '--sort', 'recent_update', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': provider },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(true);
    expect(receivedSort).toBe('recent_update');
    expect(packet.slice_sort).toBe('recent_update');
  });

  it('cr inventory rejects invalid --sort', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'http://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);

    const { logs } = await captureCliOutput(() =>
      runCli(['cr', 'inventory', '--sort', 'newest', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': createCrInventoryHookProvider() },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('invalid_args');
  });

  it('cr inventory --limit 4 returns ok when some per-PR checks are oversized', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'http://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);

    const provider = createCrInventoryHookProvider({
      listOpenPullsWithMeta: async (_ctx, opts) => ({
        numbers: [1, 2, 3, 4].slice(0, opts?.limit ?? 4),
        list_truncated: false,
      }),
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        mergeability: 'clean',
      }),
      prChecks: async (_ctx, { number }) => {
        if (number >= 3) {
          const err = new Error('oversized');
          err.forgeError = { code: 'oversized_raw_output', message: 'too big' };
          throw err;
        }
        return { check_conclusion: 'success', statuses: [] };
      },
    });

    const { logs } = await captureCliOutput(() =>
      runCli(['cr', 'inventory', '--limit', '4', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': provider },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(true);
    expect(packet.entries).toHaveLength(2);
    expect(packet.entries_skipped).toEqual([
      { pr_number: 3, error_code: 'oversized_raw_output' },
      { pr_number: 4, error_code: 'oversized_raw_output' },
    ]);
  });

  it('cr inventory fails closed when open list is truncated', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'http://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);

    const provider = createCrInventoryHookProvider({
      listOpenPullsWithMeta: async () => ({
        numbers: [1],
        entry_count: 5000,
        list_truncated: true,
      }),
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        mergeability: 'clean',
      }),
      prChecks: async () => ({ check_conclusion: 'success', statuses: [] }),
    });

    const { logs } = await captureCliOutput(() =>
      runCli(['cr', 'inventory', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': provider },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('inventory_list_incomplete');
    expect(packet.inventory_list).toEqual({ entry_count: 5000 });
  });

  it('cr inventory with cursor continues when open list is truncated', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'http://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);

    const provider = createCrInventoryHookProvider({
      listOpenPullsWithMeta: async () => ({
        numbers: [1],
        entry_count: 5000,
        list_truncated: true,
      }),
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        mergeability: 'clean',
      }),
      prChecks: async () => ({ check_conclusion: 'success', statuses: [] }),
    });

    const { logs } = await captureCliOutput(() =>
      runCli(['cr', 'inventory', '--cursor', 'dummy', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': provider },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('invalid_args');
  });

  it('cr inventory cursor iteration via CLI', async () => {
    const numbers = [1, 2, 3, 4, 5];
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'http://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);

    const provider = createCrInventoryHookProvider({
      listOpenPullsWithMeta: async (_ctx, opts) => ({
        numbers: numbers.slice(0, opts.retain_max ?? numbers.length),
        entry_count: numbers.length,
        list_truncated: false,
      }),
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        mergeability: 'clean',
      }),
      prChecks: async () => ({ check_conclusion: 'success', statuses: [] }),
    });

    const { logs: page1Logs } = await captureCliOutput(() =>
      runCli(['cr', 'inventory', '--limit', '2', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': provider },
      }),
    );
    const page1 = JSON.parse(page1Logs[0]);
    expect(page1.ok).toBe(true);
    expect(page1.has_more).toBe(true);
    expect(page1.next_cursor).toBeTruthy();

    const { logs: page2Logs } = await captureCliOutput(() =>
      runCli(['cr', 'inventory', '--limit', '2', '--cursor', page1.next_cursor, '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': provider },
      }),
    );
    const page2 = JSON.parse(page2Logs[0]);
    expect(page2.ok).toBe(true);
    expect(page2.complete).toBe(false);
    expect(page2.entries.map((e) => e.pr_number)).toEqual([3, 4]);
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
