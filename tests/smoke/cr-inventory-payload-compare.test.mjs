import { describe, it, expect } from 'vitest';
import { forgeFactInventoryPacket, FACT_INVENTORY_PACKET_TYPES, DEFAULT_MAX_BYTES } from '@remogram/core';
import { byteSize, compareReport, localGitOnlyBaseline } from '../../scripts/lib/smoke-payload-metrics.mjs';

describe('cr_inventory_slice payload compare fixtures', () => {
  it('records composed CR inventory packet metrics', () => {
    const body = {
      entries: [
        {
          pr_number: 1,
          url: 'http://localhost:3000/o/r/pulls/1',
          title: 'Smoke PR',
          state: 'open',
          base_ref: 'main',
          head_ref: 'feature/smoke-cr',
          mergeability: 'clean',
          checks_conclusion: 'missing',
          blockers: ['checks_missing'],
        },
      ],
    };

    const packet = forgeFactInventoryPacket(FACT_INVENTORY_PACKET_TYPES.CR_INVENTORY_SLICE, {
      providerId: 'gitea-api',
      remoteName: 'origin',
      repoId: 'owner/repo',
    }, body);

    const report = compareReport({
      command: 'cr_inventory_slice',
      providerId: 'gitea-api',
      remogramPacket: packet,
      baselines: localGitOnlyBaseline(),
    });

    expect(report.command).toBe('cr_inventory_slice');
    expect(report.remogram_ingest_cap_bytes).toBe(DEFAULT_MAX_BYTES);
    expect(report.remogram_packet.bytes).toBe(byteSize(packet));
    expect(packet.entries[0].blockers).toEqual(['checks_missing']);
  });
});
