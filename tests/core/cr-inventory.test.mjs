import { describe, it, expect } from 'vitest';
import { buildCrInventoryEntry, crInventory } from '@remogram/core';
import { runCli } from '@remogram/cli';
import { createMockProvider } from '../helpers/mock-provider.mjs';
import { setupTempForge, captureCliOutput } from '../helpers/temp-forge.mjs';
import { defaultTestConfig } from '../helpers/mock-provider.mjs';
import { setupRepoWithRemoteBranch } from '../helpers/stale-head-repo.mjs';

const ctx = { cwd: process.cwd(), config: { remote: 'origin' }, remoteName: 'origin' };

describe('cr inventory', () => {
  it('buildCrInventoryEntry composes view and checks facts', () => {
    const entry = buildCrInventoryEntry(
      ctx,
      {
        pr_number: 7,
        url: 'http://localhost:3000/o/r/pulls/7',
        title: 'Feature',
        state: 'open',
        base_ref: 'main',
        head_ref: 'feat',
        base_sha: 'aaa111',
        head_sha: 'bbb222',
        mergeability: 'clean',
      },
      { check_conclusion: 'success', head_sha: 'bbb222', statuses: [] },
    );
    expect(entry).toMatchObject({
      pr_number: 7,
      state: 'open',
      base_sha: 'aaa111',
      head_sha: 'bbb222',
      mergeability: 'clean',
      checks_conclusion: 'success',
      checks_truncated: false,
      blockers: [],
      head_reconcile: { stale: false },
    });
    expect(entry).not.toHaveProperty('goal_branch');
    expect(entry).not.toHaveProperty('lane');
  });

  it('buildCrInventoryEntry exposes checks_truncated when enumeration truncated', () => {
    const entry = buildCrInventoryEntry(
      ctx,
      {
        pr_number: 7,
        state: 'open',
        mergeability: 'clean',
      },
      { check_conclusion: 'success', checks_truncated: true, statuses: [] },
    );
    expect(entry.checks_truncated).toBe(true);
    expect(entry.blockers).toContain('checks_incomplete');
  });

  it('crInventory aggregates open pulls with two provider calls per entry', async () => {
    let viewCalls = 0;
    let checksCalls = 0;
    const provider = {
      listOpenPulls: async () => [1, 2],
      prView: async (_ctx, { number }) => {
        viewCalls += 1;
        return {
          pr_number: number,
          url: `http://localhost:3000/o/r/pulls/${number}`,
          title: 'One',
          state: 'open',
          base_ref: 'main',
          head_ref: 'feat',
          base_sha: 'aaa111',
          head_sha: 'bbb222',
          mergeability: 'clean',
        };
      },
      prChecks: async () => {
        checksCalls += 1;
        return {
          head_sha: 'bbb222',
          check_conclusion: 'missing',
          statuses: [],
        };
      },
    };
    const body = await crInventory(ctx, provider, { slice_ref: 'origin/remo' });
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].blockers).toEqual(['checks_missing']);
    expect(body.entries[0].base_sha).toBe('aaa111');
    expect(body.slice_ref).toBe('origin/remo');
    expect(viewCalls).toBe(2);
    expect(checksCalls).toBe(2);
  });

  it('crInventory passes retain_max entry limit to listOpenPullsWithMeta', async () => {
    let receivedRetainMax;
    const provider = {
      listOpenPullsWithMeta: async (_ctx, opts) => {
        receivedRetainMax = opts?.retain_max;
        return { numbers: [1, 2, 3], list_truncated: false, entry_count: 3 };
      },
      prView: async () => ({ pr_number: 1, state: 'open', mergeability: 'clean' }),
      prChecks: async () => ({ check_conclusion: 'success', statuses: [] }),
    };
    await crInventory(ctx, provider, { limit: 7 });
    expect(receivedRetainMax).toBe(7);
  });

  it('crInventory emits slice_sort on success packets', async () => {
    const provider = {
      listOpenPullsWithMeta: async () => ({
        numbers: [1],
        list_truncated: false,
        entry_count: 1,
        slice_sort: 'recent_update',
      }),
      prView: async () => ({ pr_number: 1, state: 'open', mergeability: 'clean' }),
      prChecks: async () => ({ check_conclusion: 'success', statuses: [] }),
    };
    const body = await crInventory(ctx, provider, { sort: 'recent_update' });
    expect(body.slice_sort).toBe('recent_update');
  });

  it('crInventory uses provider entry_count when streaming list pagination', async () => {
    const provider = {
      listOpenPullsWithMeta: async () => ({
        numbers: [1, 2, 3],
        entry_count: 50,
        list_truncated: false,
      }),
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        mergeability: 'clean',
      }),
      prChecks: async () => ({ check_conclusion: 'success', statuses: [] }),
    };
    const body = await crInventory(ctx, provider);
    expect(body.entry_count).toBe(50);
    expect(body.entries).toHaveLength(3);
    expect(body.truncated).toBe(true);
  });

  it('crInventory reports list_truncated false when forge open set matches entry cap', async () => {
    const provider = {
      listOpenPullsWithMeta: async () => ({
        numbers: [33, 41, 43],
        list_truncated: false,
      }),
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        mergeability: 'clean',
      }),
      prChecks: async () => ({ check_conclusion: 'success', statuses: [] }),
    };
    const body = await crInventory(ctx, provider);
    expect(body.entry_count).toBe(3);
    expect(body.entries).toHaveLength(3);
    expect(body.truncated).toBe(false);
    expect(body.list_truncated).toBe(false);
  });

  it('crInventory caps entries and reports truncation metadata', async () => {
    const numbers = Array.from({ length: 60 }, (_, i) => i + 1);
    const provider = {
      listOpenPulls: async () => numbers,
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        mergeability: 'clean',
      }),
      prChecks: async () => ({ check_conclusion: 'success', statuses: [] }),
    };
    const body = await crInventory(ctx, provider, { limit: 50 });
    expect(body.entry_count).toBe(60);
    expect(body.truncated).toBe(true);
    expect(body.list_truncated).toBe(false);
    expect(body.entries).toHaveLength(50);
  });

  it('crInventory returns empty entries when no open pulls are listed', async () => {
    const provider = {
      listOpenPulls: async () => [],
      prView: async () => {
        throw new Error('should not fetch');
      },
      prChecks: async () => ({ check_conclusion: 'success', statuses: [] }),
    };
    const body = await crInventory(ctx, provider);
    expect(body.entries).toEqual([]);
    expect(body.entry_count).toBe(0);
    expect(body.truncated).toBe(false);
  });

  it('crInventory records per-PR forge errors without failing the slice', async () => {
    const provider = {
      listOpenPulls: async () => [1, 2],
      prView: async (_ctx, { number }) => {
        if (number === 2) {
          const err = new Error('forge down');
          err.forgeError = { code: 'api_error', message: 'forge down' };
          throw err;
        }
        return {
          pr_number: number,
          state: 'open',
          mergeability: 'clean',
        };
      },
      prChecks: async () => ({ check_conclusion: 'success', statuses: [] }),
    };
    const body = await crInventory(ctx, provider);
    expect(body.entries).toHaveLength(1);
    expect(body.entries_skipped).toEqual([{ pr_number: 2, error_code: 'api_error' }]);
  });

  it('crInventory treats mixed-case Open state as open', async () => {
    const provider = {
      listOpenPulls: async () => [1],
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'Open',
        mergeability: 'clean',
      }),
      prChecks: async () => ({ check_conclusion: 'success', statuses: [] }),
    };
    const body = await crInventory(ctx, provider);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].blockers).toEqual([]);
  });

  it('crInventory records pr_not_open when prView returns closed state', async () => {
    const provider = {
      listOpenPulls: async () => [1],
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'closed',
        mergeability: 'clean',
      }),
      prChecks: async () => {
        throw new Error('should not fetch checks for closed PR');
      },
    };
    const body = await crInventory(ctx, provider);
    expect(body.entries).toEqual([]);
    expect(body.entries_skipped).toEqual([{ pr_number: 1, error_code: 'pr_not_open' }]);
  });

  it('crInventory mixes open entries with pr_not_open skips', async () => {
    const provider = {
      listOpenPulls: async () => [1, 2],
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: number === 1 ? 'open' : 'closed',
        mergeability: 'clean',
      }),
      prChecks: async (_ctx, { number }) => {
        if (number !== 1) throw new Error('should not fetch checks for closed PR');
        return { check_conclusion: 'success', statuses: [] };
      },
    };
    const body = await crInventory(ctx, provider);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].pr_number).toBe(1);
    expect(body.entries_skipped).toEqual([{ pr_number: 2, error_code: 'pr_not_open' }]);
  });

  it('crInventory annotates stale head_reconcile per entry without failing slice', async () => {
    const repo = setupRepoWithRemoteBranch();
    try {
      const sliceCtx = { cwd: repo.dir, config: { remote: 'origin' }, remoteName: 'origin' };
      const provider = {
        listOpenPulls: async () => [1],
        prView: async (_ctx, { number }) => ({
          pr_number: number,
          state: 'open',
          head_ref: 'feat',
          head_sha: repo.staleForgeSha,
          mergeability: 'clean',
        }),
        prChecks: async () => ({ check_conclusion: 'success', statuses: [] }),
      };
      const body = await crInventory(sliceCtx, provider);
      expect(body.entries).toHaveLength(1);
      expect(body.entries[0].head_reconcile).toEqual({
        stale: true,
        local_head_sha: repo.localSha,
        head_sha: repo.staleForgeSha,
      });
    } finally {
      repo.cleanup();
    }
  });

  it('crInventory records prChecks failure in entries_skipped', async () => {
    const provider = {
      listOpenPulls: async () => [1, 2],
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        mergeability: 'clean',
      }),
      prChecks: async (_ctx, { number }) => {
        if (number === 2) {
          const err = new Error('checks failed');
          err.forgeError = { code: 'oversized_raw_output', message: 'too big' };
          throw err;
        }
        return { check_conclusion: 'success', statuses: [] };
      },
    };
    const body = await crInventory(ctx, provider);
    expect(body.entries).toHaveLength(1);
    expect(body.entries_skipped).toEqual([
      { pr_number: 2, error_code: 'oversized_raw_output' },
    ]);
  });

  it('crInventory uses safe default limit when limit omitted', async () => {
    let receivedRetainMax;
    const provider = {
      listOpenPullsWithMeta: async (_ctx, opts) => {
        receivedRetainMax = opts?.retain_max;
        return { numbers: [1, 2, 3], entry_count: 5, list_truncated: false };
      },
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        mergeability: 'clean',
      }),
      prChecks: async () => ({ check_conclusion: 'success', statuses: [] }),
    };
    const body = await crInventory(ctx, provider);
    expect(receivedRetainMax).toBe(3);
    expect(body.entries).toHaveLength(3);
    expect(body.entry_count).toBe(5);
    expect(body.truncated).toBe(true);
    expect(body.list_truncated).toBe(false);
  });

  it('crInventory at --limit 4 degrades oversized per-PR checks without failing slice', async () => {
    const provider = {
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
          const err = new Error('checks oversized');
          err.forgeError = { code: 'oversized_raw_output', message: 'too big' };
          throw err;
        }
        return { check_conclusion: 'success', statuses: [] };
      },
    };
    const body = await crInventory(ctx, provider, { limit: 4 });
    expect(body.entries).toHaveLength(2);
    expect(body.entries_skipped).toEqual([
      { pr_number: 3, error_code: 'oversized_raw_output' },
      { pr_number: 4, error_code: 'oversized_raw_output' },
    ]);
  });

  it('crInventory propagates list_truncated from listOpenPullsWithMeta', async () => {
    const provider = {
      listOpenPullsWithMeta: async () => ({ numbers: [1], list_truncated: true }),
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        mergeability: 'clean',
      }),
      prChecks: async () => ({ check_conclusion: 'success', statuses: [] }),
    };
    const body = await crInventory(ctx, provider);
    expect(body.list_truncated).toBe(true);
    expect(body.entry_count).toBe(1);
  });

  it('createMockProvider crInventory entries require checks_truncated boolean', async () => {
    const provider = createMockProvider();
    const body = await provider.crInventory(ctx);
    expect(body.entries.length).toBeGreaterThan(0);
    for (const entry of body.entries) {
      expect(typeof entry.checks_truncated).toBe('boolean');
    }
  });

  it('cli cr inventory emits cr_inventory_slice packet', async () => {
    const config = defaultTestConfig();
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    const mock = createMockProvider();
    const { logs } = await captureCliOutput(() =>
      runCli(['cr', 'inventory', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': mock },
      }),
    );
    setup.cleanup();
    const packet = JSON.parse(logs[0]);
    expect(packet.type).toBe('cr_inventory_slice');
    expect(packet.schema_version).toBe(1);
    expect(packet.ok).toBe(true);
    expect(Array.isArray(packet.entries)).toBe(true);
    expect(packet.entries[0].pr_number).toBe(1);
    expect(packet.entries[0].head_reconcile).toEqual({ stale: false });
    expect(packet).not.toHaveProperty('goal_branch');
    expect(packet).not.toHaveProperty('sdlc_task');
  });
});
