import { describe, it, expect } from 'vitest';
import {
  OBSERVER_REMOGRAM_COMMANDS,
  OBSERVER_FACT_INVENTORY_PACKETS,
  FACT_INVENTORY_PACKET_TYPES,
  observerProtoRemogramCommands,
  semanticDiffFactCommands,
  allObserverEligibleCommands,
} from '@remogram/core';

describe('observer fact inventory contract', () => {
  it('lists repo status as the observer proto remogram command', () => {
    const proto = observerProtoRemogramCommands();
    expect(proto).toEqual([
      expect.objectContaining({ command: 'repo status', mcp_tool: 'repo_status', read_only: true }),
    ]);
  });

  it('includes semantic-diff fact inventory commands as read-only extensions', () => {
    const extended = semanticDiffFactCommands();
    expect(extended.some((entry) => entry.command === 'refs inventory')).toBe(true);
    expect(extended.some((entry) => entry.command === 'cr inventory')).toBe(true);
    expect(extended.some((entry) => entry.command === 'whoami')).toBe(true);
    expect(extended.some((entry) => entry.command === 'branch protection')).toBe(true);
    expect(extended.some((entry) => entry.command === 'cr files')).toBe(true);
    expect(extended.some((entry) => entry.command === 'cr comments')).toBe(true);
    expect(extended.some((entry) => entry.command === 'forge changes')).toBe(true);
    for (const entry of OBSERVER_REMOGRAM_COMMANDS) {
      expect(entry.read_only).toBe(true);
    }
  });

  it('registers fact inventory packet types for observer consumers', () => {
    expect(OBSERVER_FACT_INVENTORY_PACKETS.map((p) => p.packet_type)).toEqual([
      FACT_INVENTORY_PACKET_TYPES.REF_INVENTORY,
      FACT_INVENTORY_PACKET_TYPES.CR_INVENTORY_SLICE,
    ]);
    for (const packet of OBSERVER_FACT_INVENTORY_PACKETS) {
      expect(packet.read_only).toBe(true);
      expect(packet.mcp_tool).toBeTruthy();
    }
  });

  it('covers all v1 read/plan commands in observer eligibility map', () => {
    const commands = allObserverEligibleCommands().map((entry) => entry.command);
    expect(commands).toContain('cr inventory');
    expect(commands).toContain('refs inventory');
    expect(commands.every((name) => OBSERVER_REMOGRAM_COMMANDS.some((e) => e.command === name))).toBe(
      true,
    );
  });
});
