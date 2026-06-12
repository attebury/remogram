import { describe, it, expect } from 'vitest';
import { buildCrInventoryEntry, crInventory } from '@remogram/core';
import { runCli } from '@remogram/cli';
import { createMockProvider } from '../helpers/mock-provider.mjs';
import { setupTempForge, captureCliOutput } from '../helpers/temp-forge.mjs';
import { defaultTestConfig } from '../helpers/mock-provider.mjs';

describe('cr inventory', () => {
  it('buildCrInventoryEntry composes view, checks, and merge plan facts', () => {
    const entry = buildCrInventoryEntry(
      {
        pr_number: 7,
        url: 'http://localhost:3000/o/r/pulls/7',
        title: 'Feature',
        state: 'open',
        base_ref: 'main',
        head_ref: 'feat',
        mergeability: 'clean',
      },
      { check_conclusion: 'success', head_sha: 'bbb222', statuses: [] },
      {
        pr_number: 7,
        mergeability: 'clean',
        checks_conclusion: 'success',
        blockers: [],
      },
    );
    expect(entry).toMatchObject({
      pr_number: 7,
      state: 'open',
      mergeability: 'clean',
      checks_conclusion: 'success',
      blockers: [],
    });
    expect(entry).not.toHaveProperty('goal_branch');
    expect(entry).not.toHaveProperty('lane');
  });

  it('crInventory aggregates open pulls via provider hooks', async () => {
    const provider = {
      listOpenPulls: async () => [1],
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        url: 'http://localhost:3000/o/r/pulls/1',
        title: 'One',
        state: 'open',
        base_ref: 'main',
        head_ref: 'feat',
        mergeability: 'clean',
      }),
      prChecks: async () => ({
        head_sha: 'bbb222',
        check_conclusion: 'missing',
        statuses: [],
      }),
      mergePlan: async (_ctx, { number }) => ({
        pr_number: number,
        mergeability: 'clean',
        checks_conclusion: 'missing',
        blockers: ['checks_missing'],
      }),
    };
    const body = await crInventory({}, provider, { slice_ref: 'origin/remo' });
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].blockers).toEqual(['checks_missing']);
    expect(body.slice_ref).toBe('origin/remo');
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
    expect(packet).not.toHaveProperty('goal_branch');
    expect(packet).not.toHaveProperty('sdlc_task');
  });
});
