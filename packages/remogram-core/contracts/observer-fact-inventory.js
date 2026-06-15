/**
 * Remogram fact requirements for observer and semantic-diff consumer snapshots.
 * Observer proto today captures remogram repo status only; downstream consumers
 * may compose additional read-only fact packets listed here.
 */

import { FACT_INVENTORY_PACKET_TYPES, V1_READ_PLAN_COMMANDS } from './semantic-diff-facts.js';

/** CLI/MCP surface entries observer consumers may call (read-only). */
export const OBSERVER_REMOGRAM_COMMANDS = Object.freeze([
  { command: 'repo status', mcp_tool: 'repo_status', read_only: true, observer_proto: true },
  { command: 'refs inventory', mcp_tool: 'ref_inventory', read_only: true, observer_proto: false },
  { command: 'cr inventory', mcp_tool: 'cr_inventory', read_only: true, observer_proto: false },
  { command: 'refs compare', mcp_tool: 'ref_compare', read_only: true, observer_proto: false },
  { command: 'pr view', mcp_tool: 'pr_status', read_only: true, observer_proto: false },
  { command: 'pr checks', mcp_tool: 'pr_checks', read_only: true, observer_proto: false },
  { command: 'merge plan', mcp_tool: 'merge_plan', read_only: true, observer_proto: false },
  { command: 'sync plan', mcp_tool: 'sync_plan', read_only: true, observer_proto: false },
  { command: 'provider capabilities', mcp_tool: 'provider_capabilities', read_only: true, observer_proto: false },
  { command: 'doctor', mcp_tool: 'doctor', read_only: true, observer_proto: false },
]);

/** Fact inventory packet types for semantic-diff / branch-workcycle composition. */
export const OBSERVER_FACT_INVENTORY_PACKETS = Object.freeze([
  {
    packet_type: FACT_INVENTORY_PACKET_TYPES.REF_INVENTORY,
    command: 'refs inventory',
    mcp_tool: 'ref_inventory',
    read_only: true,
  },
  {
    packet_type: FACT_INVENTORY_PACKET_TYPES.CR_INVENTORY_SLICE,
    command: 'cr inventory',
    mcp_tool: 'cr_inventory',
    read_only: true,
  },
]);

/** Commands captured directly by observer-snapshot.sh today. */
export function observerProtoRemogramCommands() {
  return OBSERVER_REMOGRAM_COMMANDS.filter((entry) => entry.observer_proto);
}

/** Extended fact commands for semantic-diff inventory beyond the proto script. */
export function semanticDiffFactCommands() {
  return OBSERVER_REMOGRAM_COMMANDS.filter((entry) => !entry.observer_proto);
}

/** All v1 read/plan commands remain authoritative alongside fact inventory. */
export function allObserverEligibleCommands() {
  return V1_READ_PLAN_COMMANDS.map((command) => {
    const entry = OBSERVER_REMOGRAM_COMMANDS.find((c) => c.command === command);
    return {
      command,
      mcp_tool: entry?.mcp_tool ?? null,
      read_only: entry?.read_only ?? true,
    };
  });
}
