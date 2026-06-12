import { describe, it, expect } from 'vitest';
import {
  FACT_INVENTORY_PACKET_TYPES,
  FACT_INVENTORY_BODY_SHAPES,
  FORBIDDEN_PACKET_KEYS,
  V1_READ_PLAN_COMMANDS,
  forgeFactInventoryPacket,
  OBSERVER_FACT_INVENTORY_PACKETS,
  allObserverEligibleCommands,
} from '@remogram/core';

describe('semantic diff fact inventory contracts', () => {
  const ctx = {
    providerId: 'gitea-api',
    remoteName: 'origin',
    repoId: 'owner/repo',
  };

  for (const forbidden of FORBIDDEN_PACKET_KEYS) {
    it(`rejects forbidden key ${forbidden} in ref_inventory packets`, () => {
      expect(() =>
        forgeFactInventoryPacket(FACT_INVENTORY_PACKET_TYPES.REF_INVENTORY, ctx, {
          refs: [{ name: 'main', sha: 'a'.repeat(40) }],
          [forbidden]: 'must-not-emit',
        }),
      ).toThrow(/forbidden/i);
    });

    it(`rejects forbidden key ${forbidden} in cr_inventory_slice packets`, () => {
      expect(() =>
        forgeFactInventoryPacket(FACT_INVENTORY_PACKET_TYPES.CR_INVENTORY_SLICE, ctx, {
          entries: [],
          entry_count: 0,
          truncated: false,
          list_truncated: false,
          [forbidden]: 'must-not-emit',
        }),
      ).toThrow(/forbidden/i);
    });
  }

  it('registers ref_inventory and cr_inventory_slice packet types', () => {
    expect(Object.keys(FACT_INVENTORY_BODY_SHAPES).sort()).toEqual([
      FACT_INVENTORY_PACKET_TYPES.CR_INVENTORY_SLICE,
      FACT_INVENTORY_PACKET_TYPES.REF_INVENTORY,
    ].sort());
  });

  it('forgeFactInventoryPacket emits trusted envelope for cr_inventory_slice', () => {
    const packet = forgeFactInventoryPacket(FACT_INVENTORY_PACKET_TYPES.CR_INVENTORY_SLICE, ctx, {
      entries: [
        {
          pr_number: 1,
          state: 'open',
          mergeability: 'clean',
          checks_conclusion: 'missing',
          blockers: ['checks_missing'],
        },
      ],
    });
    expect(packet.type).toBe('cr_inventory_slice');
    expect(packet.ok).toBe(true);
    expect(packet.schema_version).toBe(1);
    expect(packet.entries[0].blockers).toEqual(['checks_missing']);
  });

  it('v1 read/plan commands include fact inventory CLI surfaces', () => {
    expect(V1_READ_PLAN_COMMANDS).toEqual(
      expect.arrayContaining(['refs inventory', 'cr inventory']),
    );
  });

  it('observer fact inventory registry aligns with v1 command map', () => {
    const observerTypes = OBSERVER_FACT_INVENTORY_PACKETS.map((entry) => entry.packet_type);
    expect(observerTypes).toContain(FACT_INVENTORY_PACKET_TYPES.REF_INVENTORY);
    expect(observerTypes).toContain(FACT_INVENTORY_PACKET_TYPES.CR_INVENTORY_SLICE);
    expect(allObserverEligibleCommands().map((entry) => entry.command)).toEqual(
      expect.arrayContaining(['refs inventory', 'cr inventory']),
    );
  });
});
