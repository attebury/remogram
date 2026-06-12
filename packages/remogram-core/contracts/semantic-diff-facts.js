/**
 * Semantic diff fact inventory contract (wave 1 — registry and trust boundaries).
 * Command implementations land in waves 2–6 per plan_semantic_diff_fact_inventory.
 *
 * @see topo/sdlc/decisions/semantic_diff_fact_layer.tg
 * @see topo/sdlc/decisions/packet_trust_doctrine.tg
 */

import { forgePacket, FORBIDDEN_PACKET_KEYS, SCHEMA_VERSION } from './envelope.js';

/** Authoritative v1 read/plan surface today. Fact inventory extends; does not replace. */
export const V1_READ_PLAN_COMMANDS = Object.freeze([
  'repo status',
  'refs compare',
  'refs inventory',
  'cr inventory',
  'pr view',
  'pr checks',
  'merge plan',
  'sync plan',
  'provider capabilities',
  'doctor',
]);

/**
 * Planned fact-inventory packet types (not emitted until wave 2+ commands ship).
 * All use schema_version 1 envelope discipline via forgePacket.
 */
export const FACT_INVENTORY_PACKET_TYPES = Object.freeze({
  REF_INVENTORY: 'ref_inventory',
  CR_INVENTORY_SLICE: 'cr_inventory_slice',
});

/** Trusted structural envelope on every remogram packet (authoritative for agents). */
export const TRUSTED_ENVELOPE_FIELDS = Object.freeze([
  'type',
  'schema_version',
  'provider_id',
  'remote_name',
  'repo_id',
  'observed_at',
  'ok',
]);

/**
 * Normalized enum and boolean body fields agents may treat as structural facts
 * (not forge prose). Provider-specific strings that are normalized to enums
 * belong here; raw forge copy does not.
 */
export const TRUSTED_NORMALIZED_BODY_FIELDS = Object.freeze({
  mergeability: true,
  check_conclusion: true,
  checks_conclusion: true,
  state: true,
  truncated: true,
  list_truncated: true,
  entry_count: true,
  mergeability_confidence: true,
  write_support: true,
  diverged: true,
  auth_present: true,
});

/**
 * String leaves copied from forge or git resolution that remain semantically
 * untrusted per decision_packet_trust_doctrine. Structurally sanitized only.
 */
export const FORGE_SOURCED_STRING_LEAVES = Object.freeze({
  repo_status: ['default_branch', 'auth_env', 'capabilities'],
  ref_compare: ['base_ref', 'head_ref', 'base_sha', 'head_sha'],
  pr_status: ['url', 'title', 'base_ref', 'head_ref', 'base_sha', 'head_sha'],
  pr_checks: ['head_sha', 'statuses[].context', 'statuses[].description', 'statuses[].target_url'],
  merge_plan: ['blockers[].message', 'blockers[].context'],
  sync_plan: ['remote', 'local_sha', 'remote_sha', 'blockers[].message'],
  ref_inventory: ['refs[].name', 'refs[].sha', 'default_ref'],
  cr_inventory_slice: [
    'entries[].url',
    'entries[].title',
    'entries[].base_ref',
    'entries[].head_ref',
    'entries[].base_sha',
    'entries[].head_sha',
    'entries[].head_reconcile.local_head_sha',
    'entries[].head_reconcile.head_sha',
    'entries[].checks[].context',
    'entries[].checks[].description',
  ],
});

/** Keys that must never appear in remogram output (Topogram SDLC/workflow concepts). */
export { FORBIDDEN_PACKET_KEYS };

/**
 * Documented body shapes for planned fact inventory packets (wave 2+).
 * Used by contract tests and provider normalization; not emitted in wave 1.
 */
export const FACT_INVENTORY_BODY_SHAPES = Object.freeze({
  [FACT_INVENTORY_PACKET_TYPES.REF_INVENTORY]: {
    refs: 'array<{ name: string, sha: string, kind?: string, is_default?: boolean }>',
    default_ref: 'string optional',
    ancestry_hints: 'array<{ base_ref: string, head_ref: string, ahead_by?: number, behind_by?: number }> optional',
  },
  [FACT_INVENTORY_PACKET_TYPES.CR_INVENTORY_SLICE]: {
    entries:
      'array<{ pr_number: number, url?: string, title?: string, state?: string, base_ref?: string, head_ref?: string, base_sha?: string, head_sha?: string, mergeability?: string, checks_conclusion?: string, blockers?: array, head_reconcile?: { stale: boolean, local_head_sha?: string, head_sha?: string } }>',
    entry_count: 'number',
    truncated: 'boolean',
    list_truncated: 'boolean',
    entries_skipped: 'array<{ pr_number: number, error_code: string }> optional',
    slice_ref: 'string optional',
  },
});

/**
 * Build a fact-inventory packet body through the standard envelope gate.
 * Throws if body contains forbidden Topogram workflow keys.
 */
export function forgeFactInventoryPacket(type, context, body = {}, error = null) {
  if (!Object.values(FACT_INVENTORY_PACKET_TYPES).includes(type)) {
    throw new Error(`Unknown fact inventory packet type: ${type}`);
  }
  return forgePacket(type, context, body, error);
}

export { SCHEMA_VERSION };
