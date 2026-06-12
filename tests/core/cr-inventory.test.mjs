import { describe, it, expect } from 'vitest';
import { buildCrInventoryEntry, crInventory } from '@remogram/core';
import { runCli } from '@remogram/cli';
import { createMockProvider } from '../helpers/mock-provider.mjs';
import { setupTempForge, captureCliOutput } from '../helpers/temp-forge.mjs';
import { defaultTestConfig } from '../helpers/mock-provider.mjs';

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
      blockers: [],
      head_reconcile: { stale: false },
    });
    expect(entry).not.toHaveProperty('goal_branch');
    expect(entry).not.toHaveProperty('lane');
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
